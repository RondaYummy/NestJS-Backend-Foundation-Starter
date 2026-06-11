import type { DomainEvent } from '@domain/events/domain-event';

export interface IOutboxWriter {
  append(event: DomainEvent, transaction?: unknown): Promise<void>;
}
