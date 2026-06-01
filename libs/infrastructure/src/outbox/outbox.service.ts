import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '@domain/events/domain-event';
import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { outboxEvents } from '../database/drizzle/schema/outbox-events.schema';
import { TOKENS } from '@contracts/tokens';
import { IAuditLogger } from '@contracts/audit/audit-logger';

@Injectable()
export class OutboxService {
  constructor(
    @Inject(TOKENS.AuditLogger)
    private readonly auditLogger: IAuditLogger,
    @Inject(DRIZZLE_DB)
    private readonly db: {
      insert: (table: unknown) => { values: (value: unknown) => Promise<unknown> };
    },
  ) {}
  async append(event: DomainEvent): Promise<void> {
    await this.db
      .insert(outboxEvents)
      .values({ id: randomUUID(), eventName: event.name, payload: event });
  }
  async processPending(): Promise<void> {
    this.auditLogger.log({
      actorType: 'system',
      action: 'outbox.processPending',
      entityType: 'outbox',
      entityId: 'outbox',
      metadata: {
        count: 0,
      },
    });
    /* TODO: select pending rows with locking and publish */
  }
}
