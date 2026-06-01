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
  async release(handle: LockHandle): Promise<void> {
    const value = await this.redis.get(`lock:${handle.key}`);
    if (value === handle.token) await this.redis.del(`lock:${handle.key}`);
  }
  async runWithLock<T>(key: string, ttlMs: number, handler: () => Promise<T>): Promise<T> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) throw new Error(`Cannot acquire lock: ${key}`);
    try {
      return await handler();
    } finally {
      await this.release(lock);
    }
  }
}
