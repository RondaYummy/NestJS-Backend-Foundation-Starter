import { Injectable } from '@nestjs/common';
import type { ICacheGateway } from '@contracts/cache/cache-gateway';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisCacheGateway implements ICacheGateway {
  private readonly prefix = 'app:';
  constructor(private readonly redis: RedisService) {}
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.prefix + key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), ttlSeconds);
  }
  async del(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
  async remember<T>(key: string, ttlSeconds: number, resolver: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await resolver();
    await this.set(key, value, ttlSeconds);
    return value;
  }
  async forgetByPattern(pattern: string): Promise<void> {
    const match = this.prefix + pattern;

    for await (const batch of this.redis.scanKeys(match)) {
      await this.redis.unlink(...batch);
    }
  }
}
