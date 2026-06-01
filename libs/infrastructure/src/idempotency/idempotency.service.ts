import { Injectable } from '@nestjs/common';
import type { IIdempotencyService } from '@contracts/idempotency/idempotency-service';
import { RedisService } from '../redis/redis.service';
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
    const cacheKey = `idem:${input.scope}:${input.key}:${input.requestHash}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
    const result = await input.handler();
    await this.redis.set(cacheKey, JSON.stringify(result), input.ttlSeconds);
    return result;
  }
}
