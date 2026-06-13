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

  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');

    return result === 'OK';
  }

  async compareAndDelete(key: string, expectedValue: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
  
      return 0
    `;

    const result = await this.redis.eval(script, 1, key, expectedValue);

    return result === 1;
  }

  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown> {
    return this.redis.eval(script, numberOfKeys, ...args);
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }> {
    const script = `
      local count = redis.call("incr", KEYS[1])
  
      if count == 1 then
        redis.call("expire", KEYS[1], ARGV[1])
      end
  
      local ttl = redis.call("ttl", KEYS[1])
  
      return { count, ttl }
    `;

    const result = (await this.redis.eval(script, 1, key, ttlSeconds)) as [number, number];

    return {
      count: Number(result[0]),
      ttl: Number(result[1]),
    };
  }

  async compareAndExpire(key: string, expectedValue: string, ttlSeconds: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      end
  
      return 0
    `;

    const result = await this.redis.eval(script, 1, key, expectedValue, ttlSeconds);

    return Number(result) === 1;
  }

  async completeIdempotency(
    lockKey: string,
    expectedLockToken: string,
    resultKey: string,
    serializedResult: string,
    resultTtlSeconds: number,
  ): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) ~= ARGV[1] then
        return 0
      end
  
      redis.call(
        "set",
        KEYS[2],
        ARGV[2],
        "EX",
        ARGV[3]
      )
  
      redis.call("del", KEYS[1])
  
      return 1
    `;

    const result = await this.redis.eval(
      script,
      2,
      lockKey,
      resultKey,
      expectedLockToken,
      serializedResult,
      resultTtlSeconds.toString(),
    );

    return Number(result) === 1;
  }
}
