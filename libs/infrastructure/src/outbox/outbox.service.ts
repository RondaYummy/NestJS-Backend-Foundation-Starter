import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { IAuditLogger } from '@contracts/audit/audit-logger';
import type { IOutboxProcessor, ProcessOutboxResult } from '@contracts/outbox/outbox-processor';
import type { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { TOKENS } from '@contracts/tokens';
import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { DomainEvent } from '@domain/events/domain-event';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb, DrizzleExecutor } from '../database/drizzle/drizzle.types';
import { outboxEvents } from '../database/drizzle/schema/outbox-events.schema';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { IDomainEventRouter } from '@contracts/events/domain-event-router';
import { resolveDrizzleExecutor } from '@infrastructure/transactions/drizzle-transaction-context';

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 50;
const LOCK_TTL_MS = 5 * 60 * 1000;

type OutboxRow = typeof outboxEvents.$inferSelect;

type ClaimedOutboxRow = OutboxRow & {
  claimWorkerId: string;
};

@Injectable()
export class OutboxService implements IOutboxWriter, IOutboxProcessor {
  constructor(
    @Inject(TOKENS.AuditLogger)
    private readonly auditLogger: IAuditLogger,

    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,

    @Inject(AppLogger)
    private readonly logger: AppLogger,

    @Inject(TOKENS.DomainEventRouter)
    private readonly domainEventRouter: IDomainEventRouter,
  ) {}

  private resolveDb(trx?: TransactionContext): DrizzleExecutor {
    return resolveDrizzleExecutor(this.db, trx);
  }

  async append(event: DomainEvent, trx?: TransactionContext): Promise<void> {
    const db = this.resolveDb(trx);

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
        const marked = await this.markProcessed(event.id, event.claimWorkerId);

        if (!marked) {
          throw new Error(`Outbox event ownership was lost: ${event.id}`);
        }

        processed += 1;
      } catch (error) {
        const marked = await this.markFailed(event, error);

        if (!marked) {
          await this.safeAudit({
            actorType: 'system',
            action: 'outbox.ownershipLost',
            entityType: 'outbox',
            entityId: event.id,
            metadata: {
              workerId: event.claimWorkerId,
              error: this.getErrorMessage(error),
            },
          });

          continue;
        }

        failed += 1;
      }
    }

    if (failed > 0) {
      this.logger.warn('Some outbox events failed', {
        selected: events.length,
        processed,
        failed,
      });
    }

    await this.safeAudit({
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

  private async claimPendingBatch(): Promise<ClaimedOutboxRow[]> {
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

      const ids = rows.map((row: OutboxRow) => row.id);

      await trx
        .update(outboxEvents)
        .set({
          status: 'processing',
          lockedAt: now,
          lockedBy: workerId,
          updatedAt: now,
        })
        .where(inArray(outboxEvents.id, ids));

      return rows.map((row: OutboxRow) => ({
        ...row,
        claimWorkerId: workerId,
      }));
    });
  }

  private async publishEvent(event: OutboxRow): Promise<void> {
    await this.domainEventRouter.route({
      id: event.id,
      name: event.eventName,
      payload: event.payload,
      occurredAt: event.occurredAt.toISOString(),
    });
  }

  private async markProcessed(id: string, workerId: string): Promise<boolean> {
    const now = new Date();

    const updated = await this.db
      .update(outboxEvents)
      .set({
        status: 'processed',
        processedAt: now,
        lockedAt: null,
        lockedBy: null,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxEvents.id, id),
          eq(outboxEvents.status, 'processing'),
          eq(outboxEvents.lockedBy, workerId),
        ),
      )
      .returning({
        id: outboxEvents.id,
      });

    return updated.length === 1;
  }

  private async markFailed(event: ClaimedOutboxRow, error: unknown): Promise<boolean> {
    const attempts = event.attempts + 1;
    const retryDelaySeconds = Math.min(2 ** attempts * 30, 3600);

    const permanentlyFailed = attempts >= MAX_ATTEMPTS;

    const now = new Date();

    const updated = await this.db
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
      .where(
        and(
          eq(outboxEvents.id, event.id),
          eq(outboxEvents.status, 'processing'),
          eq(outboxEvents.lockedBy, event.claimWorkerId),
        ),
      )
      .returning({
        id: outboxEvents.id,
      });

    return updated.length === 1;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 5000);
    }

    return String(error).slice(0, 5000);
  }

  private async safeAudit(input: Parameters<IAuditLogger['log']>[0]): Promise<void> {
    try {
      await this.auditLogger.log(input);
    } catch (error) {
      this.logger.error('Outbox audit logging failed', error, {
        action: input.action,
        entityId: input.entityId,
      });
    }
  }
}
