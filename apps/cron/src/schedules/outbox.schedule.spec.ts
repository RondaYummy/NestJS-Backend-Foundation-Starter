/// <reference types="jest" />

import type { SchedulerRegistry } from '@nestjs/schedule';
import type { IDistributedLock } from '@contracts/locks/distributed-lock';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';
import type { AppLogger } from '@infrastructure/logger/app-logger.service';
import { defaultRetryDelaySeconds } from '@infrastructure/outbox/outbox-processor.defaults';

import { OutboxSchedule } from './outbox.schedule';

type OutboxScheduleTestAccess = {
  runTickSafely(): Promise<void>;
  tickRunning: boolean;
  shuttingDown: boolean;
};

describe('OutboxSchedule', () => {
  const options: OutboxProcessorOptions = {
    batchSize: 25,
    maxAttempts: 4,
    lockTtlMs: 120_000,
    heartbeatIntervalMs: 1000,
    handlerTimeoutMs: 0,
    pollIntervalMs: 60_000,
    cronLockTtlMs: 55_000,
    concurrency: 2,
    retryDelaySeconds: defaultRetryDelaySeconds,
  };

  let schedule: OutboxSchedule;
  let scheduleAccess: OutboxScheduleTestAccess;
  let queues: jest.Mocked<Pick<IQueueGateway, 'add'>>;
  let lock: { runWithLock: jest.Mock };
  let schedulerRegistry: jest.Mocked<Pick<SchedulerRegistry, 'addInterval' | 'deleteInterval'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'debug' | 'error'>>;

  beforeEach(() => {
    queues = {
      add: jest.fn().mockResolvedValue('job-id'),
    };
    lock = {
      runWithLock: jest.fn(async (_key: string, _ttl: number, handler: () => Promise<unknown>) =>
        handler(),
      ),
    };
    schedulerRegistry = {
      addInterval: jest.fn(),
      deleteInterval: jest.fn(),
    };
    logger = {
      debug: jest.fn(),
      error: jest.fn(),
    };

    schedule = new OutboxSchedule(
      queues as unknown as IQueueGateway,
      lock as unknown as IDistributedLock,
      options,
      schedulerRegistry as unknown as SchedulerRegistry,
      logger as unknown as AppLogger,
    );
    scheduleAccess = schedule as unknown as OutboxScheduleTestAccess;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const runTickSafely = (): Promise<void> => scheduleAccess.runTickSafely();

  it('logs and swallows tick failures without leaving tickRunning set', async () => {
    const failure = new Error('queue unavailable');
    queues.add.mockRejectedValueOnce(failure);

    await expect(runTickSafely()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('Outbox cron tick failed', failure);
    expect(scheduleAccess.tickRunning).toBe(false);

    await expect(runTickSafely()).resolves.toBeUndefined();
    expect(queues.add).toHaveBeenCalledTimes(2);
  });

  it('prevents overlapping ticks in the same process', async () => {
    let releaseFirstTick: (() => void) | undefined;
    const firstTickStarted = new Promise<void>((resolve) => {
      queues.add.mockImplementationOnce(
        () =>
          new Promise<string>((resolveAdd) => {
            releaseFirstTick = () => resolveAdd('job-id');
            resolve();
          }),
      );
    });

    const firstTick = runTickSafely();
    await firstTickStarted;

    await runTickSafely();

    expect(queues.add).toHaveBeenCalledTimes(1);

    releaseFirstTick?.();
    await firstTick;

    expect(scheduleAccess.tickRunning).toBe(false);
  });

  it('suppresses new ticks after shutdown begins', async () => {
    schedule.onModuleDestroy();

    await runTickSafely();

    expect(lock.runWithLock).not.toHaveBeenCalled();
    expect(queues.add).not.toHaveBeenCalled();
    expect(scheduleAccess.shuttingDown).toBe(true);
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith('outbox-schedule');
  });

  it('logs lock-not-acquired skips without enqueueing', async () => {
    lock.runWithLock.mockResolvedValueOnce(null);

    await schedule.tick();

    expect(logger.debug).toHaveBeenCalledWith(
      'Outbox cron tick skipped; distributed lock not acquired',
      { lockKey: 'cron:outbox' },
    );
    expect(queues.add).not.toHaveBeenCalled();
  });

  it('routes interval callbacks through runTickSafely', async () => {
    jest.useFakeTimers();
    const runTickSafelySpy = jest.spyOn(scheduleAccess, 'runTickSafely');

    schedule.onModuleInit();

    jest.advanceTimersByTime(options.pollIntervalMs);
    await Promise.resolve();

    expect(runTickSafelySpy).toHaveBeenCalledTimes(1);
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'outbox-schedule',
      expect.any(Object),
    );
    expect(queues.add).toHaveBeenCalledWith(
      QUEUES.OUTBOX,
      'process-pending-outbox-events',
      {},
      {
        jobId: 'outbox-process-pending',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });
});
