import { Injectable } from '@nestjs/common';
import type { IRateLimiter } from '@contracts/rate-limiter/rate-limiter';
import { RedisService } from '../redis/redis.service';
@Injectable()
export class RedisRateLimiter implements IRateLimiter {
  constructor(private readonly redis: RedisService) {}
  async check(input: {
    key: string;
    limit: number;
    ttlSeconds: number;
  }): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const count = await this.redis.incr(input.key);
    if (count === 1) await this.redis.expire(input.key, input.ttlSeconds);
    const ttl = await this.redis.ttl(input.key);
    return {
      allowed: count <= input.limit,
      remaining: Math.max(input.limit - count, 0),
      resetAt: new Date(Date.now() + ttl * 1000),
    };
  }
}
