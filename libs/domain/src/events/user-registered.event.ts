import { randomUUID } from 'node:crypto';
import type { DomainEvent } from './domain-event';

export class UserRegisteredEvent implements DomainEvent {
  readonly id = randomUUID();
  readonly name = 'user.registered';
  readonly occurredAt = new Date();

  constructor(
    readonly payload: {
      userId: string;
      email: string;
    },
  ) {}
}
