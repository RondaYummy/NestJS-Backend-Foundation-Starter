import type { DomainEvent } from '@domain/events/domain-event';
export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;
  publishMany(events: DomainEvent[]): Promise<void>;
}
