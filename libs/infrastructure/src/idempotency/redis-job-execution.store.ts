import { Injectable } from '@nestjs/common';

import type { IJobExecutionStore } from '@contracts/idempotency/job-execution-store';
import { RedisService } from '@infrastructure/redis/redis.service';

@Injectable()
export class RedisJobExecutionStore implements IJobExecutionStore {
  constructor(private readonly redis: RedisService) {}

  async isCompleted(key: string): Promise<boolean> {
    return this.redis.exists(this.buildKey(key));
  }

  async markCompleted(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.buildKey(key), 'completed', ttlSeconds);
  }

  private buildKey(key: string): string {
    return `job-execution:${key}`;
  }
}
