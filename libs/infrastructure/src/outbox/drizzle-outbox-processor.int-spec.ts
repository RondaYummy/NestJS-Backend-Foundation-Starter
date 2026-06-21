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

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/app';

const TEST_OPTIONS: OutboxProcessorOptions = {
  batchSize: 10,
  maxAttempts: 3,
  lockTtlMs: 2_000,
  heartbeatIntervalMs: 500,
  handlerTimeoutMs: 0,
  pollIntervalMs: 60_000,
  cronLockTtlMs: 55_000,
  concurrency: 1,
  retryDelaySeconds: () => 30,
};

async function isPostgresAvailable(): Promise<boolean> {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });

  try {
    await pool.query('SELECT 1 FROM outbox_events LIMIT 1');
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

function createProcessor(
  db: DrizzleDb,
  routeDelayMs: number,
  routeCount: { value: number },
  processorOptions: OutboxProcessorOptions = TEST_OPTIONS,
): DrizzleOutboxProcessor {
  const domainEventRouter: IDomainEventRouter = {
    route: jest.fn(() => {
      routeCount.value += 1;

      return new Promise<void>((resolve) => {
        setTimeout(resolve, routeDelayMs);
      });
    }),
  };

  const auditLogger: IAuditLogger = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLogger;

  return new DrizzleOutboxProcessor(auditLogger, db, logger, domainEventRouter, processorOptions);
}

describe('DrizzleOutboxProcessor integration', () => {
  let postgresAvailable = false;
  let pool: Pool;
  let db: DrizzleDb;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();

    if (!postgresAvailable) {
      console.warn(
        `Skipping DrizzleOutboxProcessor integration tests: PostgreSQL unavailable at ${DATABASE_URL}`,
      );
    }
  });

  beforeEach(() => {
    if (!postgresAvailable) {
      return;
    }

    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
    });

    db = drizzle(pool);
  });

  afterEach(async () => {
    if (!postgresAvailable) {
      return;
    }

    await pool.end();
  });

  it('prevents a second worker from reclaiming an event while heartbeat renews the lease', async () => {
    if (!postgresAvailable) {
      return;
    }

    const eventId = randomUUID();
    const routeCount = { value: 0 };

    await db.insert(outboxEvents).values({
      id: eventId,
      eventName: 'integration.test',
      payload: { source: 'p0-02' },
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      occurredAt: new Date(),
    });

    const processorA = createProcessor(db, 5_000, routeCount);
    const processorB = createProcessor(db, 0, { value: 0 });

    const claimPendingBatch = (
      processorB as unknown as {
        claimPendingBatch: () => Promise<Array<{ id: string }>>;
      }
    ).claimPendingBatch.bind(processorB);

    const processPromise = processorA.processPending();

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const reclaimed = await claimPendingBatch();
    const reclaimedIds = reclaimed.map((row) => row.id);

    expect(reclaimedIds).not.toContain(eventId);

    const result = await processPromise;

    expect(result.processed).toBe(1);
    expect(routeCount.value).toBe(1);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));

    expect(row?.status).toBe('processed');

    await db.delete(outboxEvents).where(eq(outboxEvents.id, eventId));
  }, 20_000);

  it('prevents reclaim while timed-out handler is still running (V-09 / P2-04)', async () => {
    if (!postgresAvailable) {
      return;
    }

    const timeoutOptions: OutboxProcessorOptions = {
      ...TEST_OPTIONS,
      lockTtlMs: 3_000,
      heartbeatIntervalMs: 500,
      handlerTimeoutMs: 2_000,
      retryDelaySeconds: () => 0,
    };

    const eventId = randomUUID();
    const routeCount = { value: 0 };

    await db.insert(outboxEvents).values({
      id: eventId,
      eventName: 'integration.test',
      payload: { source: 'v-09' },
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      occurredAt: new Date(),
    });

    const processorA = createProcessor(db, 5_000, routeCount, timeoutOptions);
    const processorB = createProcessor(db, 0, { value: 0 }, timeoutOptions);

    const claimPendingBatch = (
      processorB as unknown as {
        claimPendingBatch: () => Promise<Array<{ id: string }>>;
      }
    ).claimPendingBatch.bind(processorB);

    const processPromise = processorA.processPending();

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const reclaimed = await claimPendingBatch();
    const reclaimedIds = reclaimed.map((row) => row.id);

    expect(reclaimedIds).not.toContain(eventId);
    expect(routeCount.value).toBe(1);

    const result = await processPromise;

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(routeCount.value).toBe(1);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));

    expect(row?.status).not.toBe('processed');
    expect(row?.lockedAt).toBeNull();
    expect(row?.lockedBy).toBeNull();

    await db.delete(outboxEvents).where(eq(outboxEvents.id, eventId));
  }, 20_000);
});
