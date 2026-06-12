import type { DomainEvent } from '@domain/events/domain-event';
import type { TransactionContext } from '@contracts/transactions/transaction-manager';

export interface IOutboxWriter<TTransaction = unknown> {
  append(event: DomainEvent, trx?: TransactionContext<TTransaction>): Promise<void>;
}
