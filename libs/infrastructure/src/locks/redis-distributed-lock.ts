import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { IDistributedLock, LockHandle } from '@contracts/locks/distributed-lock';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisDistributedLock implements IDistributedLock {
  constructor(private readonly redis: RedisService) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = randomUUID();
    const acquired = await this.redis.setPxIfNotExists(this.lockKey(key), token, ttlMs);

    return acquired ? { key, token } : null;
  }

  private readonly releaseScript = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end

  return 0
`;

  async release(handle: LockHandle): Promise<void> {
    await this.redis.eval(this.releaseScript, 1, this.lockKey(handle.key), handle.token);
  }

  private readonly extendScript = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  end

  return 0
`;

  async extend(handle: LockHandle, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(
      this.extendScript,
      1,
      this.lockKey(handle.key),
      handle.token,
      ttlMs,
    );

    return Number(result) === 1;
  }

  async runWithLock<T>(key: string, ttlMs: number, handler: () => Promise<T>): Promise<T | null> {
    const lock = await this.acquire(key, ttlMs);

    if (!lock) {
      return null;
    }

    const heartbeatIntervalMs = Math.max(Math.floor(ttlMs / 3), 1_000);

    let lockLost = false;
    let heartbeatInProgress = false;

    const heartbeat = setInterval(() => {
      if (heartbeatInProgress) {
        return;
      }

      heartbeatInProgress = true;

      void this.extend(lock, ttlMs)
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
    }, heartbeatIntervalMs);

    heartbeat.unref();

    try {
      const result = await handler();

      if (lockLost) {
        throw new Error(`Distributed lock was lost during execution: ${key}`);
      }

      return result;
    } finally {
      clearInterval(heartbeat);
      await this.release(lock);
    }
  }

  private lockKey(key: string): string {
    return `lock:${key}`;
  }
}
