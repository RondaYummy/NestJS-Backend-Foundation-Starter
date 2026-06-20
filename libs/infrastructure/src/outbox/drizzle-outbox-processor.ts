import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { IAuditLogger } from '@contracts/audit/audit-logger';
import type { IOutboxProcessor, ProcessOutboxResult } from '@contracts/outbox/outbox-processor';
import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';
import { TOKENS } from '@contracts/tokens';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb } from '../database/drizzle/drizzle.types';
import { outboxEvents } from '../database/drizzle/schema/outbox-events.schema';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { IDomainEventRouter } from '@contracts/events/domain-event-router';

type OutboxRow = typeof outboxEvents.$inferSelect;

type ClaimedOutboxRow = OutboxRow & {
  claimWorkerId: string;
};

@Injectable()
export class DrizzleOutboxProcessor implements IOutboxProcessor {
  constructor(
    @Inject(TOKENS.AuditLogger)
    private readonly auditLogger: IAuditLogger,

    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,

    @Inject(AppLogger)
    private readonly logger: AppLogger,

    @Inject(TOKENS.DomainEventRouter)
    private readonly domainEventRouter: IDomainEventRouter,

    @Inject(TOKENS.OutboxProcessorOptions)
    private readonly options: OutboxProcessorOptions,
  ) {}

  async processPending(): Promise<ProcessOutboxResult> {
    const events = await this.claimPendingBatch();

    let processed = 0;
    let failed = 0;

    for (const event of events) {
      let ownershipLost = false;
      let heartbeatInProgress = false;
      let heartbeat: NodeJS.Timeout | undefined;

      heartbeat = setInterval(() => {
        if (heartbeatInProgress || ownershipLost) {
          return;
        }

        heartbeatInProgress = true;

        void this.extendLock(event.id, event.claimWorkerId)
          .then((extended) => {
            if (!extended) {
              ownershipLost = true;
            }
          })
          .catch(() => {
            ownershipLost = true;
          })
          .finally(() => {
            heartbeatInProgress = false;
          });
      }, this.options.heartbeatIntervalMs);

      heartbeat.unref();

      try {
        await this.publishEventWithTimeout(event);

        if (ownershipLost) {
          throw new Error(`Outbox event ownership was lost during publish: ${event.id}`);
        }

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
      } finally {
        if (heartbeat) {
          clearInterval(heartbeat);
        }
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

    const expiredLockAt = new Date(now.getTime() - this.options.lockTtlMs);

    return this.db.transaction(async (trx) => {
      const rows = await trx
        .select()
        .from(outboxEvents)
        .where(
          and(
            lte(outboxEvents.availableAt, now),
            lte(outboxEvents.attempts, this.options.maxAttempts - 1),
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
        .limit(this.options.batchSize)
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

  private async publishEventWithTimeout(event: OutboxRow): Promise<void> {
    if (this.options.handlerTimeoutMs <= 0) {
      await this.publishEvent(event);
      return;
    }

    let timeoutId: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.publishEvent(event),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(`Outbox handler timeout after ${this.options.handlerTimeoutMs}ms`),
              ),
            this.options.handlerTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async extendLock(id: string, workerId: string): Promise<boolean> {
    const now = new Date();

    const updated = await this.db
      .update(outboxEvents)
      .set({
        lockedAt: now,
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
    const retryDelaySeconds = this.options.retryDelaySeconds(attempts);

    const permanentlyFailed = attempts >= this.options.maxAttempts;

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
