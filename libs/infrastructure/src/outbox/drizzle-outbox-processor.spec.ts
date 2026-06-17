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
    pollIntervalMs: 60_000,
    cronLockTtlMs: 55_000,
    concurrency: 2,
    retryDelaySeconds: defaultRetryDelaySeconds,
  };

  let processor: DrizzleOutboxProcessor;
  let db: {
    transaction: jest.Mock;
  };
  let domainEventRouter: jest.Mocked<Pick<IDomainEventRouter, 'route'>>;
  let auditLogger: jest.Mocked<Pick<IAuditLogger, 'log'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'warn' | 'error'>>;

  beforeEach(() => {
    db = {
      transaction: jest.fn(),
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
});
