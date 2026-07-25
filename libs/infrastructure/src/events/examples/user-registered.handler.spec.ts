/// <reference types="jest" />

import type { RoutableDomainEvent } from '@contracts/events/domain-event-router';
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';

import { UserRegisteredEventHandler } from './user-registered.handler';

describe('UserRegisteredEventHandler', () => {
  it('supports only the user.registered event', () => {
    const handler = new UserRegisteredEventHandler({
      add: jest.fn(),
    } as unknown as IQueueGateway);

    expect(handler.supports('user.registered')).toBe(true);
    expect(handler.supports('user.updated')).toBe(false);
  });

  it('enqueues the welcome email on QUEUES.EMAIL (AC-04)', async () => {
    const add = jest.fn();
    const handler = new UserRegisteredEventHandler({ add } as unknown as IQueueGateway);

    const event: RoutableDomainEvent = {
      id: 'evt-42',
      name: 'user.registered',
      payload: { userId: 'user-1', email: 'user@example.com' },
      occurredAt: new Date().toISOString(),
    };

    await handler.handle(event);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      QUEUES.EMAIL,
      'send-welcome-email',
      expect.objectContaining({
        to: 'user@example.com',
        template: EMAIL_TEMPLATE.WELCOME,
        idempotencyKey: 'user-registered:evt-42:welcome',
      }),
      { jobId: 'welcome-email:evt-42' },
    );
  });
});
