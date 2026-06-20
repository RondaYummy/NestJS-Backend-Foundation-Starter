/// <reference types="jest" />

import type { IAuditLogger } from '@contracts/audit/audit-logger';
import type { IDomainEventRouter } from '@contracts/events/domain-event-router';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

import type { DrizzleDb } from '../database/drizzle/drizzle.types';
import type { AppLogger } from '@infrastructure/logger/app-logger.service';
import { DrizzleOutboxProcessor } from './drizzle-outbox-processor';
import { defaultRetryDelaySeconds } from './outbox-processor.defaults';

describe('DrizzleOutboxProcessor', () => {
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

  let processor: DrizzleOutboxProcessor;
  let db: {
    transaction: jest.Mock;
    update: jest.Mock;
  };
  let domainEventRouter: jest.Mocked<Pick<IDomainEventRouter, 'route'>>;
  let auditLogger: jest.Mocked<Pick<IAuditLogger, 'log'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'warn' | 'error'>>;

  beforeEach(() => {
    jest.useFakeTimers();

    db = {
      transaction: jest.fn(),
      update: jest.fn(),
    };
    domainEventRouter = {
      route: jest.fn(),
    };
    auditLogger = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };

    processor = new DrizzleOutboxProcessor(
      auditLogger,
      db as unknown as DrizzleDb,
      logger as unknown as AppLogger,
      domainEventRouter,
      options,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses configured batch size and max attempts when claiming pending events', async () => {
    const forUpdate = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ for: forUpdate });
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const trx = { select, update: jest.fn() };

    db.transaction.mockImplementation(
      async (callback: (innerTrx: typeof trx) => Promise<unknown>) => callback(trx),
    );

    await processor.processPending();

    expect(limit).toHaveBeenCalledWith(options.batchSize);
    expect(where).toHaveBeenCalled();
  });

  it('uses configured retry delay when marking failed events', async () => {
    const retryDelaySeconds = jest.fn().mockReturnValue(90);
    const processorWithRetry = new DrizzleOutboxProcessor(
      auditLogger,
      {
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([{ id: 'event-1' }]),
            }),
          }),
        }),
      } as unknown as DrizzleDb,
      logger as unknown as AppLogger,
      domainEventRouter,
      {
        ...options,
        retryDelaySeconds,
      },
    );

    const markFailed = (
      processorWithRetry as unknown as {
        markFailed: (
          event: {
            id: string;
            attempts: number;
            claimWorkerId: string;
          },
          error: Error,
        ) => Promise<boolean>;
      }
    ).markFailed.bind(processorWithRetry);

    await markFailed(
      {
        id: 'event-1',
        attempts: 1,
        claimWorkerId: 'worker-1',
      },
      new Error('route failed'),
    );

    expect(retryDelaySeconds).toHaveBeenCalledWith(2);
  });

  it('returns true from extendLock when the conditional update succeeds', async () => {
    const returning = jest.fn().mockResolvedValue([{ id: 'event-1' }]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });

    const extendLock = (
      processor as unknown as {
        extendLock: (id: string, workerId: string) => Promise<boolean>;
      }
    ).extendLock.bind(processor);

    const extended = await extendLock('event-1', 'worker-1');

    expect(extended).toBe(true);
    expect(where).toHaveBeenCalled();
  });

  it('returns false from extendLock when lockedBy does not match', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });

    const extendLock = (
      processor as unknown as {
        extendLock: (id: string, workerId: string) => Promise<boolean>;
      }
    ).extendLock.bind(processor);

    const extended = await extendLock('event-1', 'wrong-worker');

    expect(extended).toBe(false);
  });

  it('does not count processed when ownership is lost during publish', async () => {
    jest.useFakeTimers();

    const claimedEvent = {
      id: 'event-1',
      eventName: 'user.created',
      payload: { userId: 'u-1' },
      status: 'processing',
      attempts: 0,
      availableAt: new Date(),
      lockedAt: new Date(),
      lockedBy: 'worker-1',
      occurredAt: new Date(),
      processedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      claimWorkerId: 'worker-1',
    };

    const forUpdate = jest.fn().mockResolvedValue([claimedEvent]);
    const limit = jest.fn().mockReturnValue({ for: forUpdate });
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const trxUpdate = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const trx = { select, update: trxUpdate };

    db.transaction.mockImplementation(
      async (callback: (innerTrx: typeof trx) => Promise<unknown>) => callback(trx),
    );

    let extendCallCount = 0;

    domainEventRouter.route.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2500);
        }),
    );

    db.update.mockImplementation(() => ({
      set: jest.fn().mockImplementation((values: Record<string, unknown>) => {
        if ('lockedAt' in values && !('status' in values)) {
          extendCallCount += 1;

          return {
            where: jest.fn().mockReturnValue({
              returning: jest
                .fn()
                .mockResolvedValue(extendCallCount === 1 ? [{ id: 'event-1' }] : []),
            }),
          };
        }

        return {
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        };
      }),
    }));

    const processPromise = processor.processPending();

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1500);
    await jest.runAllTimersAsync();

    const result = await processPromise;

    expect(result.processed).toBe(0);
    expect(domainEventRouter.route).toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'outbox.ownershipLost',
        entityId: 'event-1',
      }),
    );
  });
});
