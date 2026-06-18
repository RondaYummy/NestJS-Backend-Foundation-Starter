/// <reference types="jest" />

import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';

import type { IAuditLogger } from '@contracts/audit/audit-logger';
import type { IDomainEventRouter } from '@contracts/events/domain-event-router';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

import type { DrizzleDb } from '../database/drizzle/drizzle.types';
import { outboxEvents } from '../database/drizzle/schema/outbox-events.schema';
import type { AppLogger } from '@infrastructure/logger/app-logger.service';
import { DrizzleOutboxProcessor } from './drizzle-outbox-processor';
import { defaultRetryDelaySeconds } from './outbox-processor.defaults';

const DATABASE_URL = process.env.DATABASE_URL;

const TEST_OUTBOX_OPTIONS: OutboxProcessorOptions = {
  batchSize: 10,
  maxAttempts: 3,
  lockTtlMs: 2000,
  lockHeartbeatIntervalMs: 500,
  handlerTimeoutMs: 10_000,
  pollIntervalMs: 60_000,
  cronLockTtlMs: 55_000,
  concurrency: 1,
  retryDelaySeconds: defaultRetryDelaySeconds,
};

async function isPostgresAvailable(): Promise<boolean> {
  if (!DATABASE_URL) {
    return false;
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 2_000,
  });

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    await pool.end();
    return true;
  } catch {
    try {
      await pool.end();
    } catch {
      // ignore cleanup errors when PostgreSQL is unavailable
    }

    return false;
  }
}

function buildProcessor(
  db: DrizzleDb,
  domainEventRouter: IDomainEventRouter,
): DrizzleOutboxProcessor {
  const auditLogger: IAuditLogger = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLogger;

  return new DrizzleOutboxProcessor(
    auditLogger,
    db,
    logger,
    domainEventRouter,
    TEST_OUTBOX_OPTIONS,
  );
}

describe('DrizzleOutboxProcessor integration (V-04)', () => {
  let postgresAvailable = false;
  let pool: Pool;
  let db: DrizzleDb;
  let routeDelayMs: number;
  let routeCount: number;
  let domainEventRouter: IDomainEventRouter;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();

    if (!postgresAvailable) {
      console.warn(
        'Skipping DrizzleOutboxProcessor integration tests: PostgreSQL unavailable (DATABASE_URL missing or unreachable)',
      );
    }
  });

  beforeEach(() => {
    if (!postgresAvailable) {
      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool);
    routeDelayMs = 5_000;
    routeCount = 0;

    domainEventRouter = {
      route: jest.fn(() => {
        routeCount += 1;
        return new Promise<void>((resolve) => {
          setTimeout(resolve, routeDelayMs);
        });
      }),
    };
  });

  afterEach(async () => {
    if (!postgresAvailable) {
      return;
    }

    await db.delete(outboxEvents);
    await pool.end();
  });

  it('publishes a long-running event once when a second worker overlaps after lock expiry', async () => {
    if (!postgresAvailable) {
      return;
    }

    const eventId = randomUUID();

    await db.insert(outboxEvents).values({
      id: eventId,
      eventName: 'test.event',
      payload: { source: 'v04' },
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      occurredAt: new Date(),
    });

    const processorA = buildProcessor(db, domainEventRouter);
    const processorB = buildProcessor(db, domainEventRouter);

    const firstRun = processorA.processPending();

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const secondRun = processorB.processPending();

    await Promise.allSettled([firstRun, secondRun]);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));

    expect(routeCount).toBe(1);
    expect(domainEventRouter.route).toHaveBeenCalledTimes(1);
    expect(row?.status).toBe('processed');
  }, 20_000);
});
