/// <reference types="jest" />

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import type {
  IDomainEventRouter,
  RoutableDomainEvent,
} from '@contracts/events/domain-event-router';
import { TOKENS } from '@contracts/tokens';

import { EventsModule } from './events.module';

@Injectable()
class RecordingHandler implements IDomainEventHandler {
  readonly handled: RoutableDomainEvent[] = [];

  supports(eventName: string): boolean {
    return eventName === 'test.event';
  }

  handle(event: RoutableDomainEvent): Promise<void> {
    this.handled.push(event);
    return Promise.resolve();
  }
}

function makeEvent(name: string): RoutableDomainEvent {
  return {
    id: 'evt-1',
    name,
    payload: {},
    occurredAt: new Date().toISOString(),
  };
}

describe('EventsModule', () => {
  it('resolves an empty handler set and routes an unknown event without throwing (AC-02)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventsModule.register()],
    }).compile();

    const handlers = moduleRef.get<IDomainEventHandler[]>(TOKENS.DomainEventHandlers, {
      strict: false,
    });
    expect(handlers).toEqual([]);

    const router = moduleRef.get<IDomainEventRouter>(TOKENS.DomainEventRouter, { strict: false });
    await expect(router.route(makeEvent('unknown.event'))).resolves.toBeUndefined();

    await moduleRef.close();
  });

  it('routes a matching event to a caller-supplied handler (AC-03)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventsModule.register({ handlers: [RecordingHandler] })],
    }).compile();

    const handler = moduleRef.get(RecordingHandler, { strict: false });
    const router = moduleRef.get<IDomainEventRouter>(TOKENS.DomainEventRouter, { strict: false });

    await router.route(makeEvent('test.event'));

    expect(handler.handled).toHaveLength(1);
    expect(handler.handled[0]?.name).toBe('test.event');

    await moduleRef.close();
  });
});
