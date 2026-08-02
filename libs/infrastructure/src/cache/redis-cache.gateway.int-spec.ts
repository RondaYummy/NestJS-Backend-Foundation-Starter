/// <reference types="jest" />

import Redis from 'ioredis';

import { assertRedisAvailable } from '../../../../test/integration/infra-availability';
import { RedisCacheGateway } from './redis-cache.gateway';
import { RedisKeyBuilder } from '../redis/redis-key-builder';
import { RedisService } from '../redis/redis.service';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);

const TEST_PREFIX = 'app:cache:p2-03:';
const OTHER_KEY = 'app:cache:other:c';

describe('RedisCacheGateway integration (V-08)', () => {
  let infraReady = false;
  let redisClient: Redis;
  let redisService: RedisService;
  let gateway: RedisCacheGateway;

  beforeAll(async () => {
    await assertRedisAvailable({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
    });
    infraReady = true;
  });

  beforeEach(() => {
    // Skip resource setup only when beforeAll already failed closed.
    if (!infraReady) {
      return;
    }

    redisClient = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      maxRetriesPerRequest: null,
    });

    redisService = new RedisService(redisClient, new RedisKeyBuilder('app'));
    gateway = new RedisCacheGateway(redisService);
  });

  afterEach(async () => {
    if (!redisClient) {
      return;
    }

    await redisClient.del(`${TEST_PREFIX}a`, `${TEST_PREFIX}b`, OTHER_KEY);
    await redisClient.quit();
  });

  it('forgetByPattern removes matching keys and preserves unrelated keys', async () => {
    await redisClient.set(`${TEST_PREFIX}a`, '1');
    await redisClient.set(`${TEST_PREFIX}b`, '2');
    await redisClient.set(OTHER_KEY, '3');

    await gateway.forgetByPattern('cache:p2-03:*');

    expect(await redisClient.exists(`${TEST_PREFIX}a`)).toBe(0);
    expect(await redisClient.exists(`${TEST_PREFIX}b`)).toBe(0);
    expect(await redisClient.exists(OTHER_KEY)).toBe(1);
  });
});
