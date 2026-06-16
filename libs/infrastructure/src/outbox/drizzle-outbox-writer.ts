import { Inject, Injectable } from '@nestjs/common';

import type { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { DomainEvent } from '@domain/events/domain-event';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import type { DrizzleDb, DrizzleExecutor } from '../database/drizzle/drizzle.types';
import { outboxEvents } from '../database/drizzle/schema/outbox-events.schema';
import { resolveDrizzleExecutor } from '../transactions/drizzle-transaction-context';

@Injectable()
export class DrizzleOutboxWriter implements IOutboxWriter {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  async append(event: DomainEvent, trx?: TransactionContext): Promise<void> {
    const executor = this.resolveExecutor(trx);

    await executor.insert(outboxEvents).values({
      id: event.id,
      eventName: event.name,
      payload: event.payload,
      occurredAt: event.occurredAt,
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
    });
  }

  private resolveExecutor(trx?: TransactionContext): DrizzleExecutor {
    return resolveDrizzleExecutor(this.db, trx);
  }
}
