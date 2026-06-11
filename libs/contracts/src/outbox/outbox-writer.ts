import type { TransactionContext } from '@contracts/transactions/transaction-manager';
import type { DomainEvent } from '@domain/events/domain-event';

export interface IOutboxWriter {
  append(event: DomainEvent, trx?: TransactionContext): Promise<void>;
}
