import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisKeyBuilder } from './redis-key-builder';
import { REDIS_CLIENT } from './redis.tokens';

@Injectable()
export class RedisService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly keyBuilder: RedisKeyBuilder,
  ) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(this.toPhysicalKey(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const physicalKey = this.toPhysicalKey(key);

    if (ttlSeconds !== undefined) {
      await this.redis.set(physicalKey, value, 'EX', ttlSeconds);
      return;
    }

    await this.redis.set(physicalKey, value);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.toPhysicalKey(key));
  }

  async *scanKeys(match: string, count = 100): AsyncGenerator<string[]> {
    let cursor = '0';
    const physicalMatch = this.toPhysicalPattern(match);

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        physicalMatch,
        'COUNT',
        count,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        yield keys.map((key) => this.toLogicalKey(key));
      }
    } while (cursor !== '0');
  }

  async unlink(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    return this.redis.unlink(...keys.map((key) => this.toPhysicalKey(key)));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(this.toPhysicalKey(key))) === 1;
  }

  ttl(key: string): Promise<number> {
    return this.redis.ttl(this.toPhysicalKey(key));
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(this.toPhysicalKey(key));
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(this.toPhysicalKey(key), seconds);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return Promise.resolve(0);
    }

    return this.redis.sadd(this.toPhysicalKey(key), ...members);
  }

  smembers(key: string): Promise<string[]> {
    return this.redis.smembers(this.toPhysicalKey(key));
  }

  srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return Promise.resolve(0);
    }

    return this.redis.srem(this.toPhysicalKey(key), ...members);
  }

  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(this.toPhysicalKey(key), value, 'EX', ttlSeconds, 'NX');

    return result === 'OK';
  }

  async setPxIfNotExists(key: string, value: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(this.toPhysicalKey(key), value, 'PX', ttlMs, 'NX');

    return result === 'OK';
  }

  async compareAndDelete(key: string, expectedValue: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
  
      return 0
    `;

    const result = await this.eval(script, 1, key, expectedValue);

    return result === 1;
  }

  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const physicalKeys = args
      .slice(0, numberOfKeys)
      .map((key) => this.toPhysicalKey(String(key)));
    const remainingArgs = args.slice(numberOfKeys);

    return this.redis.eval(script, numberOfKeys, ...physicalKeys, ...remainingArgs);
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

    const result = (await this.eval(script, 1, key, ttlSeconds)) as [number, number];

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

    const result = await this.eval(script, 1, key, expectedValue, ttlSeconds);

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

    const result = await this.eval(
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

  private toPhysicalKey(logicalKey: string): string {
    return this.keyBuilder.toPhysicalKey(logicalKey);
  }

  private toPhysicalPattern(logicalPattern: string): string {
    return this.keyBuilder.toPhysicalPattern(logicalPattern);
  }

  private toLogicalKey(physicalKey: string): string {
    return this.keyBuilder.toLogicalKey(physicalKey);
  }
}
