import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { IIdempotencyService } from '@contracts/idempotency/idempotency-service';
import { ConflictError } from '@domain/errors/domain-errors';

import { RedisService } from '../redis/redis.service';

type StoredIdempotencyResult<T> = {
  requestHash: string;
  response: T;
};

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

    const cached = await this.redis.get(resultKey);

    if (cached) {
      return this.parseStoredResult<T>(cached, input.requestHash);
    }

    const lockToken = randomUUID();

    const lockAcquired = await this.redis.setIfNotExists(lockKey, lockToken, 30);

    if (!lockAcquired) {
      return this.waitForResult<T>({
        resultKey,
        expectedRequestHash: input.requestHash,
      });
    }

    try {
      const doubleChecked = await this.redis.get(resultKey);

      if (doubleChecked) {
        return this.parseStoredResult<T>(doubleChecked, input.requestHash);
      }

      const result = await input.handler();

      const stored: StoredIdempotencyResult<T> = {
        requestHash: input.requestHash,
        response: result,
      };

      await this.redis.set(resultKey, JSON.stringify(stored), input.ttlSeconds);

      return result;
    } finally {
      await this.redis.compareAndDelete(lockKey, lockToken);
    }
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
    expectedRequestHash: string;
  }): Promise<T> {
    const maxAttempts = 50;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.sleep(delayMs);

      const cached = await this.redis.get(input.resultKey);

      if (cached) {
        return this.parseStoredResult<T>(cached, input.expectedRequestHash);
      }
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
