/// <reference types="jest" />

import { RedisCacheGateway } from './redis-cache.gateway';
import type { RedisService } from '../redis/redis.service';

describe('RedisCacheGateway', () => {
  let redis: {
    scanKeys: jest.Mock;
    unlink: jest.Mock;
    del: jest.Mock;
  };
  let gateway: RedisCacheGateway;

  beforeEach(() => {
    redis = {
      scanKeys: jest.fn(),
      unlink: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };

    gateway = new RedisCacheGateway(redis as unknown as RedisService);
  });

  async function* scanBatches(...batches: string[][]): AsyncGenerator<string[]> {
    for (const batch of batches) {
      await Promise.resolve();
      yield batch;
    }
  }

  it('forgetByPattern scans app-prefixed match and unlinks discovered keys in batches', async () => {
    redis.scanKeys.mockReturnValue(
      scanBatches(['app:user:1', 'app:user:2'], ['app:user:3']),
    );

    await gateway.forgetByPattern('user:*');

    expect(redis.scanKeys).toHaveBeenCalledWith('app:user:*');
    expect(redis.unlink).toHaveBeenCalledTimes(2);
    expect(redis.unlink).toHaveBeenNthCalledWith(1, 'app:user:1', 'app:user:2');
    expect(redis.unlink).toHaveBeenNthCalledWith(2, 'app:user:3');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('forgetByPattern is a no-op when scan returns no keys', async () => {
    redis.scanKeys.mockReturnValue(scanBatches());

    await gateway.forgetByPattern('user:*');

    expect(redis.scanKeys).toHaveBeenCalledWith('app:user:*');
    expect(redis.unlink).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
