import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { IJobExecutionStore } from '@contracts/idempotency/job-execution-store';
import { RedisService } from '@infrastructure/redis/redis.service';

@Injectable()
export class RedisJobExecutionStore implements IJobExecutionStore {
  constructor(private readonly redis: RedisService) {}

  async acquire(key: string, ttlSeconds: number): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.redis.setIfNotExists(this.buildKey(key), token, ttlSeconds);

    return acquired ? token : null;
  }

  async extend(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean> {
    return this.redis.compareAndExpire(this.buildKey(key), ownershipToken, ttlSeconds);
  }

  async complete(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("set", KEYS[1], "completed", "EX", ARGV[2])
      end

      return nil
    `;

    const result = await this.redis.eval(script, 1, this.buildKey(key), ownershipToken, ttlSeconds);

    return result === 'OK';
  }

  async release(key: string, ownershipToken: string): Promise<void> {
    await this.redis.compareAndDelete(this.buildKey(key), ownershipToken);
  }

  async markAmbiguousSent(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.buildKey(key), 'sent-ambiguous', ttlSeconds);
  }

  private buildKey(key: string): string {
    return `job-execution:${key}`;
  }
}
