import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { IIdempotencyService } from '@contracts/idempotency/idempotency-service';
import { ConflictError } from '@domain/errors/domain-errors';

import { RedisService } from '../redis/redis.service';

type StoredIdempotencyResult<T> = {
  requestHash: string;
  response: T;
};

const LOCK_TTL_SECONDS = 30;
const HEARTBEAT_INTERVAL_MS = 10_000;
const WAIT_TIMEOUT_MS = 15_000;
const WAIT_POLL_MS = 100;

@Injectable()
export class RedisIdempotencyService implements IIdempotencyService {
  constructor(private readonly redis: RedisService) {}

  async execute<T>(input: {
    key: string;
    scope: string;
    requestHash: string;
    ttlSeconds: number;
    handler: () => Promise<T>;
  }): Promise<T> {
    const baseKey = `idem:${input.scope}:${input.key}`;
    const resultKey = `${baseKey}:result`;
    const lockKey = `${baseKey}:lock`;
    const fenceKey = `${baseKey}:fence`;

    const cached = await this.redis.get(resultKey);

    if (cached) {
      return this.parseStoredResult<T>(cached, input.requestHash);
    }

    await this.assertFenceAllowsExecution(fenceKey, input.requestHash);

    const lockToken = randomUUID();

    const lockAcquired = await this.redis.acquireIdempotencyLockWithFence({
      lockKey,
      fenceKey,
      lockToken,
      lockTtlSeconds: LOCK_TTL_SECONDS,
      fenceValue: input.requestHash,
      fenceTtlSeconds: input.ttlSeconds,
    });

    if (!lockAcquired) {
      return this.waitForResult<T>({
        resultKey,
        lockKey,
        fenceKey,
        expectedRequestHash: input.requestHash,
        timeoutMs: WAIT_TIMEOUT_MS,
      });
    }

    let lockLost = false;
    let heartbeatInProgress = false;

    const heartbeat = setInterval(() => {
      if (heartbeatInProgress) {
        return;
      }

      heartbeatInProgress = true;

      void this.redis
        .compareAndExpire(lockKey, lockToken, LOCK_TTL_SECONDS)
        .then((extended) => {
          if (!extended) {
            lockLost = true;
          }
        })
        .catch(() => {
          lockLost = true;
        })
        .finally(() => {
          heartbeatInProgress = false;
        });
    }, HEARTBEAT_INTERVAL_MS);

    heartbeat.unref();

    let outcomeStored = false;
    let handlerSucceeded = false;

    try {
      const doubleChecked = await this.redis.get(resultKey);

      if (doubleChecked) {
        return this.parseStoredResult<T>(doubleChecked, input.requestHash);
      }

      const result = await input.handler();
      handlerSucceeded = true;

      const stored: StoredIdempotencyResult<T> = {
        requestHash: input.requestHash,
        response: result,
      };
      const serialized = JSON.stringify(stored);

      if (!lockLost) {
        const completed = await this.redis.completeIdempotency(
          lockKey,
          lockToken,
          resultKey,
          serialized,
          input.ttlSeconds,
          fenceKey,
        );

        if (completed) {
          outcomeStored = true;
          return result;
        }

        lockLost = true;
      }

      const persisted = await this.persistAfterLockLoss<T>({
        resultKey,
        fenceKey,
        serialized,
        ttlSeconds: input.ttlSeconds,
        expectedRequestHash: input.requestHash,
        handlerResult: result,
      });

      outcomeStored = true;
      return persisted;
    } finally {
      clearInterval(heartbeat);

      if (!outcomeStored) {
        await this.redis.compareAndDelete(lockKey, lockToken);

        if (!handlerSucceeded) {
          await this.redis.deleteIdempotencyFence(fenceKey);
        }
      }
    }
  }

  private async persistAfterLockLoss<T>(input: {
    resultKey: string;
    fenceKey: string;
    serialized: string;
    ttlSeconds: number;
    expectedRequestHash: string;
    handlerResult: T;
  }): Promise<T> {
    let persistedRaw: string;

    try {
      persistedRaw = await this.redis.persistIdempotencyResultBestEffort({
        resultKey: input.resultKey,
        fenceKey: input.fenceKey,
        serializedResult: input.serialized,
        resultTtlSeconds: input.ttlSeconds,
      });
    } catch {
      throw new ConflictError(
        'IDEMPOTENCY_OUTCOME_UNKNOWN',
        'Idempotency outcome could not be confirmed after lock loss; do not treat as never executed',
      );
    }

    if (persistedRaw === input.serialized) {
      return input.handlerResult;
    }

    return this.parseStoredResult<T>(persistedRaw, input.expectedRequestHash);
  }

  private async assertFenceAllowsExecution(
    fenceKey: string,
    expectedRequestHash: string,
  ): Promise<void> {
    const fence = await this.redis.get(fenceKey);

    if (!fence) {
      return;
    }

    if (fence !== expectedRequestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used with a different request payload',
      );
    }

    throw new ConflictError(
      'IDEMPOTENCY_OUTCOME_UNKNOWN',
      'Idempotency fence is set without a stored result; do not treat as never executed',
    );
  }

  private parseStoredResult<T>(raw: string, expectedRequestHash: string): T {
    const stored = JSON.parse(raw) as StoredIdempotencyResult<T>;

    if (stored.requestHash !== expectedRequestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used with a different request payload',
      );
    }

    return stored.response;
  }

  private async waitForResult<T>(input: {
    resultKey: string;
    lockKey: string;
    fenceKey: string;
    expectedRequestHash: string;
    timeoutMs: number;
  }): Promise<T> {
    const deadline = Date.now() + input.timeoutMs;
    let sawFenceWithoutResult = false;

    while (Date.now() < deadline) {
      await this.sleep(WAIT_POLL_MS);

      const cached = await this.redis.get(input.resultKey);

      if (cached) {
        return this.parseStoredResult<T>(cached, input.expectedRequestHash);
      }

      const lockExists = await this.redis.exists(input.lockKey);

      if (lockExists) {
        continue;
      }

      const fence = await this.redis.get(input.fenceKey);

      if (fence) {
        sawFenceWithoutResult = true;

        if (fence !== input.expectedRequestHash) {
          throw new ConflictError(
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency key was already used with a different request payload',
          );
        }

        continue;
      }

      break;
    }

    if (sawFenceWithoutResult) {
      const cached = await this.redis.get(input.resultKey);

      if (cached) {
        return this.parseStoredResult<T>(cached, input.expectedRequestHash);
      }

      throw new ConflictError(
        'IDEMPOTENCY_OUTCOME_UNKNOWN',
        'Idempotency fence is set without a stored result; do not treat as never executed',
      );
    }

    throw new ConflictError(
      'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      'An identical request is already being processed',
    );
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
