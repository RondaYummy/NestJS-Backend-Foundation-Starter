import { randomUUID } from 'node:crypto';
import type { DomainEvent } from './domain-event';

export class UserCreatedEvent implements DomainEvent {
  readonly id = randomUUID();
  readonly name = 'user.created';
  readonly occurredAt = new Date();
  constructor(public readonly payload: { userId: string; email: string; name: string }) {}
}
