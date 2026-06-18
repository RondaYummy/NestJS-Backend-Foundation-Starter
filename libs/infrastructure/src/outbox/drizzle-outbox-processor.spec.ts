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
    lockHeartbeatIntervalMs: 1000,
    handlerTimeoutMs: 120_000,
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

  it('returns true from renewEventLease when exactly one row is updated', async () => {
    const returning = jest.fn().mockResolvedValue([{ id: 'event-1' }]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });

    const renewEventLease = (
      processor as unknown as {
        renewEventLease: (eventId: string, workerId: string) => Promise<boolean>;
      }
    ).renewEventLease.bind(processor);

    const renewed = await renewEventLease('event-1', 'worker-1');

    expect(renewed).toBe(true);
    expect(where).toHaveBeenCalled();
  });

  it('returns false from renewEventLease when no row is updated', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });

    const renewEventLease = (
      processor as unknown as {
        renewEventLease: (eventId: string, workerId: string) => Promise<boolean>;
      }
    ).renewEventLease.bind(processor);

    const renewed = await renewEventLease('event-1', 'worker-1');

    expect(renewed).toBe(false);
  });

  it('invokes lease renewal during slow publication', async () => {
    const heartbeatOptions: OutboxProcessorOptions = {
      ...options,
      lockHeartbeatIntervalMs: 500,
      handlerTimeoutMs: 10_000,
    };

    const renewEventLease = jest.fn().mockResolvedValue(true);
    const heartbeatProcessor = new DrizzleOutboxProcessor(
      auditLogger,
      db as unknown as DrizzleDb,
      logger as unknown as AppLogger,
      domainEventRouter,
      heartbeatOptions,
    );

    (
      heartbeatProcessor as unknown as {
        renewEventLease: typeof renewEventLease;
      }
    ).renewEventLease = renewEventLease;

    domainEventRouter.route.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1500);
        }),
    );

    const publishEventWithLease = (
      heartbeatProcessor as unknown as {
        publishEventWithLease: (event: {
          id: string;
          eventName: string;
          payload: unknown;
          occurredAt: Date;
          claimWorkerId: string;
        }) => Promise<void>;
      }
    ).publishEventWithLease.bind(heartbeatProcessor);

    const publishPromise = publishEventWithLease({
      id: 'event-1',
      eventName: 'test.event',
      payload: {},
      occurredAt: new Date(),
      claimWorkerId: 'worker-1',
    });

    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(500);
    await publishPromise;

    expect(renewEventLease).toHaveBeenCalled();
  });

  it('aborts publication when lease renewal returns false', async () => {
    const heartbeatOptions: OutboxProcessorOptions = {
      ...options,
      lockHeartbeatIntervalMs: 500,
      handlerTimeoutMs: 10_000,
    };

    const renewEventLease = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const heartbeatProcessor = new DrizzleOutboxProcessor(
      auditLogger,
      db as unknown as DrizzleDb,
      logger as unknown as AppLogger,
      domainEventRouter,
      heartbeatOptions,
    );

    (
      heartbeatProcessor as unknown as {
        renewEventLease: typeof renewEventLease;
      }
    ).renewEventLease = renewEventLease;

    domainEventRouter.route.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        }),
    );

    const publishEventWithLease = (
      heartbeatProcessor as unknown as {
        publishEventWithLease: (event: {
          id: string;
          eventName: string;
          payload: unknown;
          occurredAt: Date;
          claimWorkerId: string;
        }) => Promise<void>;
      }
    ).publishEventWithLease.bind(heartbeatProcessor);

    const publishPromise = publishEventWithLease({
      id: 'event-1',
      eventName: 'test.event',
      payload: {},
      occurredAt: new Date(),
      claimWorkerId: 'worker-1',
    });

    const expectation = expect(publishPromise).rejects.toThrow(
      'Outbox event ownership was lost during publication: event-1',
    );

    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(1000);

    await expectation;
  });
});
