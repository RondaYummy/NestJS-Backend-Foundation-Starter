import { Inject, Injectable } from '@nestjs/common';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import type {
  IDomainEventRouter,
  RoutableDomainEvent,
} from '@contracts/events/domain-event-router';
import { TOKENS } from '@contracts/tokens';

@Injectable()
export class DomainEventRouter implements IDomainEventRouter {
  constructor(
    @Inject(TOKENS.DomainEventHandlers)
    private readonly handlers: readonly IDomainEventHandler[],
  ) {}

  async route(event: RoutableDomainEvent): Promise<void> {
    const handlers = this.handlers.filter((handler) => handler.supports(event.name));

    if (handlers.length === 0) {
      throw new Error(`No domain event handler registered for ${event.name}`);
    }

    for (const handler of handlers) {
      await handler.handle(event);
    }
  }
}
