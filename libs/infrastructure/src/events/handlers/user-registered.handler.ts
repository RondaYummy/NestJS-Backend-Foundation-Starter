import { Inject, Injectable } from '@nestjs/common';

import type { IDomainEventHandler } from '@contracts/events/domain-event-handler';
import type { RoutableDomainEvent } from '@contracts/events/domain-event-router';
import type { EmailJobPayload } from '@contracts/mail/email-job';
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { QUEUES } from '@contracts/queues/queue-names';
import { TOKENS } from '@contracts/tokens';

type UserRegisteredPayload = {
  userId: string;
  email: string;
};

@Injectable()
export class UserRegisteredEventHandler implements IDomainEventHandler {
  constructor(
    @Inject(TOKENS.QueueGateway)
    private readonly queueGateway: IQueueGateway,
  ) {}

  supports(eventName: string): boolean {
    return eventName === 'user.registered';
  }

  async handle(event: RoutableDomainEvent): Promise<void> {
    const payload = event.payload as UserRegisteredPayload;

    const emailJob: EmailJobPayload = {
      to: payload.email,
      subject: 'Welcome',
      template: EMAIL_TEMPLATE.WELCOME,
      data: {
        email: payload.email,
      },
    };

    await this.queueGateway.add(QUEUES.EMAIL, 'send-welcome-email', emailJob, {
      jobId: `welcome-email:${event.id}`,
    });
  }
}
