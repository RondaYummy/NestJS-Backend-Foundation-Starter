import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.tokens';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await this.redis.set(key, value);
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }
  ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }
  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }
  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }
}
