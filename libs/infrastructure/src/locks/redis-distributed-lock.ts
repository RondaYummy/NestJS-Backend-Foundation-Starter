import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { IDistributedLock, LockHandle } from '@contracts/locks/distributed-lock';
import { REDIS_CLIENT } from '../redis/redis.tokens';

@Injectable()
export class RedisDistributedLock implements IDistributedLock {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = randomUUID();
    const result = await this.redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? { key, token } : null;
  }

  private readonly releaseScript = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end

  return 0
`;

  async release(handle: LockHandle): Promise<void> {
    await this.redis.eval(this.releaseScript, 1, `lock:${handle.key}`, handle.token);
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
      `lock:${handle.key}`,
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

    try {
      return await handler();
    } finally {
      await this.release(lock);
    }
  }
}
