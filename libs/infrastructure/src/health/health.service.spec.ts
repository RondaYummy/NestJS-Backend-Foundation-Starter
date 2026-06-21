/// <reference types="jest" />

import type { Queue } from 'bullmq';
import type Redis from 'ioredis';

import { HealthService } from './health.service';
import type { HealthModuleOptions } from './health.module-options';

describe('HealthService', () => {
  const checkTimeoutMs = 100;

  let db: { execute: jest.Mock };
  let redis: { ping: jest.Mock };
  let outboxQueue: { getJobCounts: jest.Mock };
  let options: HealthModuleOptions;
  let health: HealthService;

  beforeEach(() => {
    jest.useFakeTimers();

    db = {
      execute: jest.fn(),
    };
    redis = {
      ping: jest.fn(),
    };
    outboxQueue = {
      getJobCounts: jest.fn(),
    };
    options = { checkTimeoutMs };
    health = new HealthService(
      db,
      redis as unknown as Redis,
      outboxQueue as unknown as Queue,
      options,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns ok when all dependencies respond within the deadline (V-10 baseline)', async () => {
    db.execute.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');
    outboxQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    });

    const resultPromise = health.check();
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      status: 'ok',
      services: {
        postgres: 'ok',
        redis: 'ok',
        bullmq: 'ok',
      },
    });
  });

  it('maps thrown dependency errors to service error without blocking others (V-10)', async () => {
    db.execute.mockRejectedValue(new Error('connection refused'));
    redis.ping.mockResolvedValue('PONG');
    outboxQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    });

    const resultPromise = health.check();
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe('error');
    expect(result.services.postgres).toBe('error');
    expect(result.services.redis).toBe('ok');
    expect(result.services.bullmq).toBe('ok');
  });

  it('returns within the deadline when postgres hangs and marks it as error (V-10)', async () => {
    db.execute.mockReturnValue(new Promise(() => {}));
    redis.ping.mockResolvedValue('PONG');
    outboxQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    });

    const startedAt = Date.now();
    const resultPromise = health.check();

    jest.advanceTimersByTime(checkTimeoutMs);

    const result = await resultPromise;
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(250);
    expect(result.status).toBe('error');
    expect(result.services.postgres).toBe('error');
    expect(result.services.redis).toBe('ok');
    expect(result.services.bullmq).toBe('ok');
  });
});
