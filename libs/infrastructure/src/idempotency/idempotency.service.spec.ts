/// <reference types="jest" />

import { RedisIdempotencyService } from './idempotency.service';
import type { RedisService } from '../redis/redis.service';

describe('RedisIdempotencyService', () => {
  let redis: jest.Mocked<
    Pick<
      RedisService,
      | 'get'
      | 'acquireIdempotencyLockWithFence'
      | 'compareAndExpire'
      | 'compareAndDelete'
      | 'completeIdempotency'
      | 'persistIdempotencyResultBestEffort'
      | 'deleteIdempotencyFence'
      | 'exists'
    >
  >;
  let service: RedisIdempotencyService;

  const baseInput = {
    key: 'req-1',
    scope: 'orders:create',
    requestHash: 'hash-a',
    ttlSeconds: 3600,
  };

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      acquireIdempotencyLockWithFence: jest.fn().mockResolvedValue(true),
      compareAndExpire: jest.fn().mockResolvedValue(true),
      compareAndDelete: jest.fn().mockResolvedValue(true),
      completeIdempotency: jest.fn().mockResolvedValue(true),
      persistIdempotencyResultBestEffort: jest.fn(),
      deleteIdempotencyFence: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
    };

    service = new RedisIdempotencyService(redis as unknown as RedisService);
  });

  it('stores result on happy path and replays without re-running handler', async () => {
    const handler = jest.fn().mockResolvedValue({ orderId: 'o-1' });
    const stored = JSON.stringify({
      requestHash: baseInput.requestHash,
      response: { orderId: 'o-1' },
    });

    redis.completeIdempotency.mockImplementation(() => {
      redis.get.mockResolvedValue(stored);
      return Promise.resolve(true);
    });

    const first = await service.execute({ ...baseInput, handler });
    const second = await service.execute({ ...baseInput, handler });

    expect(first).toEqual({ orderId: 'o-1' });
    expect(second).toEqual({ orderId: 'o-1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.completeIdempotency).toHaveBeenCalledWith(
      'idem:orders:create:req-1:lock',
      expect.any(String),
      'idem:orders:create:req-1:result',
      stored,
      3600,
      'idem:orders:create:req-1:fence',
    );
    expect(redis.persistIdempotencyResultBestEffort).not.toHaveBeenCalled();
  });

  it('best-effort persists after lock loss and blocks a second handler when store fails', async () => {
    const handler = jest.fn().mockResolvedValue({ orderId: 'o-2' });

    redis.completeIdempotency.mockResolvedValue(false);
    redis.persistIdempotencyResultBestEffort.mockRejectedValue(new Error('redis down'));

    await expect(service.execute({ ...baseInput, handler })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.deleteIdempotencyFence).not.toHaveBeenCalled();

    redis.get.mockImplementation((key: string) => {
      if (key.endsWith(':fence')) {
        return Promise.resolve(baseInput.requestHash);
      }

      return Promise.resolve(null);
    });
    redis.acquireIdempotencyLockWithFence.mockClear();
    handler.mockClear();

    await expect(service.execute({ ...baseInput, handler })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
    });

    expect(handler).not.toHaveBeenCalled();
    expect(redis.acquireIdempotencyLockWithFence).not.toHaveBeenCalled();
  });

  it('returns handler result when best-effort persist succeeds after lock loss', async () => {
    const response = { orderId: 'o-3' };
    const handler = jest.fn().mockResolvedValue(response);
    const serialized = JSON.stringify({
      requestHash: baseInput.requestHash,
      response,
    });

    redis.completeIdempotency.mockResolvedValue(false);
    redis.persistIdempotencyResultBestEffort.mockResolvedValue(serialized);

    await expect(service.execute({ ...baseInput, handler })).resolves.toEqual(response);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.persistIdempotencyResultBestEffort).toHaveBeenCalledWith({
      resultKey: 'idem:orders:create:req-1:result',
      fenceKey: 'idem:orders:create:req-1:fence',
      serializedResult: serialized,
      resultTtlSeconds: 3600,
    });
  });

  it('rejects hash collision with IDEMPOTENCY_KEY_REUSED', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({
        requestHash: 'other-hash',
        response: { orderId: 'o-9' },
      }),
    );

    const handler = jest.fn();

    await expect(service.execute({ ...baseInput, handler })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed when Redis get fails before handler', async () => {
    redis.get.mockRejectedValue(new Error('redis unavailable'));
    const handler = jest.fn();

    await expect(service.execute({ ...baseInput, handler })).rejects.toThrow('redis unavailable');
    expect(handler).not.toHaveBeenCalled();
  });

  it('clears fence when handler fails before success', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('business failure'));

    await expect(service.execute({ ...baseInput, handler })).rejects.toThrow('business failure');

    expect(redis.compareAndDelete).toHaveBeenCalled();
    expect(redis.deleteIdempotencyFence).toHaveBeenCalledWith(
      'idem:orders:create:req-1:fence',
    );
  });

  it('surfaces fence hash mismatch as IDEMPOTENCY_KEY_REUSED', async () => {
    redis.get.mockImplementation((key: string) => {
      if (key.endsWith(':fence')) {
        return Promise.resolve('other-hash');
      }

      return Promise.resolve(null);
    });

    const handler = jest.fn();

    await expect(service.execute({ ...baseInput, handler })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
