/// <reference types="jest" />

import { RedisJobExecutionStore } from './redis-job-execution.store';
import type { RedisService } from '@infrastructure/redis/redis.service';

describe('RedisJobExecutionStore', () => {
  let redis: jest.Mocked<Pick<RedisService, 'setIfNotExists' | 'compareAndDelete' | 'eval'>>;
  let store: RedisJobExecutionStore;

  beforeEach(() => {
    redis = {
      setIfNotExists: jest.fn(),
      compareAndDelete: jest.fn(),
      eval: jest.fn(),
    };

    store = new RedisJobExecutionStore(redis as unknown as RedisService);
  });

  it('acquire returns ownership token when SET NX succeeds', async () => {
    redis.setIfNotExists.mockResolvedValue(true);

    const token = await store.acquire('welcome:user-1', 300);

    expect(token).toEqual(expect.any(String));
    expect(redis.setIfNotExists).toHaveBeenCalledWith('job-execution:welcome:user-1', token, 300);
  });

  it('acquire returns null when key already exists', async () => {
    redis.setIfNotExists.mockResolvedValue(false);

    const token = await store.acquire('welcome:user-1', 300);

    expect(token).toBeNull();
  });

  it('complete sets completed value when ownership token matches', async () => {
    redis.eval.mockResolvedValue('OK');

    const result = await store.complete('welcome:user-1', 'token-a', 2_592_000);

    expect(result).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("set", KEYS[1], "completed"'),
      1,
      'job-execution:welcome:user-1',
      'token-a',
      2_592_000,
    );
  });

  it('complete returns false when ownership token does not match', async () => {
    redis.eval.mockResolvedValue(null);

    const result = await store.complete('welcome:user-1', 'wrong-token', 2_592_000);

    expect(result).toBe(false);
  });

  it('release deletes key only for the current owner', async () => {
    redis.compareAndDelete.mockResolvedValue(true);

    await store.release('welcome:user-1', 'token-a');

    expect(redis.compareAndDelete).toHaveBeenCalledWith('job-execution:welcome:user-1', 'token-a');
  });

  it('allows only one acquire when the key is already claimed', async () => {
    redis.setIfNotExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const firstToken = await store.acquire('welcome:user-1', 300);
    const secondToken = await store.acquire('welcome:user-1', 300);

    expect(firstToken).toEqual(expect.any(String));
    expect(secondToken).toBeNull();
  });
});
