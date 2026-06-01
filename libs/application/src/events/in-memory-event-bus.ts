import type { IEventBus } from '@contracts/events/event-bus';
import { DomainEvent } from '@domain/events/domain-event';
import { Injectable } from '@nestjs/common';

@Injectable()
export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<
    string,
    Array<(event: DomainEvent) => Promise<void>>
  >();

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.name) ?? [];

    for (const handler of handlers) {
      await handler(event);
    }
  }

  async publishMany(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe(
    eventName: string,
    handler: (event: DomainEvent) => Promise<void>,
  ): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }
}