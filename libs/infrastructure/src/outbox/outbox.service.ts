import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { IAuditLogger } from '@contracts/audit/audit-logger';
import type { IOutboxProcessor, ProcessOutboxResult } from '@contracts/outbox/outbox-processor';
import type { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';
import { TOKENS } from '@contracts/tokens';
import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { DomainEvent } from '@domain/events/domain-event';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb } from '../database/drizzle/drizzle.types';
import { outboxEvents } from '../database/drizzle/schema/outbox-events.schema';

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 50;
const LOCK_TTL_MS = 5 * 60 * 1000;

type OutboxRow = typeof outboxEvents.$inferSelect;

type DrizzleTransactionContext = TransactionContext<DrizzleDb>;

@Injectable()
export class OutboxService implements IOutboxWriter<DrizzleDb>, IOutboxProcessor {
  constructor(
    @Inject(TOKENS.AuditLogger)
    private readonly auditLogger: IAuditLogger,

    @Inject(TOKENS.QueueGateway)
    private readonly queueGateway: IQueueGateway,

    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  async append(event: DomainEvent, trx?: DrizzleTransactionContext): Promise<void> {
    const db = trx?.tx ?? this.db;

    await db.insert(outboxEvents).values({
      id: event.id,
      eventName: event.name,
      payload: event.payload,

      /**
       * Час, коли domain-подія фактично виникла.
       * Це не те саме, що createdAt outbox-запису.
       */
      occurredAt: event.occurredAt,

      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
    });
  }

  async processPending(): Promise<ProcessOutboxResult> {
    const events = await this.claimPendingBatch();

    let processed = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await this.publishEvent(event);
        await this.markProcessed(event.id);

        processed += 1;
      } catch (error) {
        await this.markFailed(event, error);

        failed += 1;
      }
    }

    await this.auditLogger.log({
      actorType: 'system',
      action: 'outbox.processPending',
      entityType: 'outbox',
      entityId: 'batch',
      metadata: {
        selected: events.length,
        processed,
        failed,
      },
    });

    return {
      selected: events.length,
      processed,
      failed,
    };
  }

  private async claimPendingBatch(): Promise<OutboxRow[]> {
    const workerId = randomUUID();
    const now = new Date();

    const expiredLockAt = new Date(now.getTime() - LOCK_TTL_MS);

    return this.db.transaction(async (trx) => {
      const rows = await trx
        .select()
        .from(outboxEvents)
        .where(
          and(
            lte(outboxEvents.availableAt, now),
            lte(outboxEvents.attempts, MAX_ATTEMPTS - 1),
            sql`
              (
                ${outboxEvents.status} = 'pending'
                OR (
                  ${outboxEvents.status} = 'processing'
                  AND (
                    ${outboxEvents.lockedAt} IS NULL
                    OR ${outboxEvents.lockedAt} < ${expiredLockAt}
                  )
                )
              )
            `,
          ),
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(BATCH_SIZE)
        .for('update', {
          skipLocked: true,
        });

      if (rows.length === 0) {
        return [];
      }

      const ids = rows.map((row) => row.id);

      await trx
        .update(outboxEvents)
        .set({
          status: 'processing',
          lockedAt: now,
          lockedBy: workerId,
          updatedAt: now,
        })
        .where(inArray(outboxEvents.id, ids));

      /**
       * Повертаємо snapshot вибраних рядків.
       *
       * attempts у них ще старий, і це нормально:
       * attempts збільшується лише після помилки.
       */
      return rows;
    });
  }

  private async publishEvent(event: OutboxRow): Promise<void> {
    await this.queueGateway.add(
      QUEUES.EVENTS,
      event.eventName,
      {
        outboxEventId: event.id,
        eventName: event.eventName,
        payload: event.payload,

        /**
         * Передаємо час виникнення domain event,
         * а не час створення outbox-запису.
         */
        occurredAt: event.occurredAt,
      },
      {
        /**
         * Одна outbox-подія повинна створювати
         * одну логічну BullMQ job.
         */
        jobId: `outbox-${event.id}`,
      },
    );
  }

  private async markProcessed(id: string): Promise<void> {
    const now = new Date();

    await this.db
      .update(outboxEvents)
      .set({
        status: 'processed',
        processedAt: now,
        lockedAt: null,
        lockedBy: null,
        error: null,
        updatedAt: now,
      })
      .where(eq(outboxEvents.id, id));
  }

  private async markFailed(event: OutboxRow, error: unknown): Promise<void> {
    const attempts = event.attempts + 1;

    const retryDelaySeconds = Math.min(2 ** attempts * 30, 3600);

    const permanentlyFailed = attempts >= MAX_ATTEMPTS;

    const now = new Date();

    await this.db
      .update(outboxEvents)
      .set({
        status: permanentlyFailed ? 'failed' : 'pending',

        attempts,

        error: this.getErrorMessage(error),

        availableAt: permanentlyFailed ? now : new Date(now.getTime() + retryDelaySeconds * 1000),

        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(eq(outboxEvents.id, event.id));
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 5000);
    }

    return String(error).slice(0, 5000);
  }
}
