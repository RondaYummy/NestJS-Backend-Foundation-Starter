import type { RoutableDomainEvent } from './domain-event-router';

export interface IDomainEventHandler {
  supports(eventName: string): boolean;
  handle(event: RoutableDomainEvent): Promise<void>;
}
