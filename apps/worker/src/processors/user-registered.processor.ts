import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { Inject } from '@nestjs/common';

type OutboxJob = {
  outboxEventId: string;
  eventName: string;
  payload: unknown;
};
type UserRegisteredPayload = { userId: string; email: string };

@Injectable()
@Processor(QUEUES.EVENTS)
export class DomainEventsProcessor extends WorkerHost {
  constructor(
    @Inject(TOKENS.EmailGateway)
    private readonly emailGateway: IEmailGateway,
  ) {
    super();
  }

  async process(job: Job<OutboxJob>): Promise<void> {
    switch (job.data.eventName) {
      case 'user.registered':
        await this.handleUserRegistered(job.data.payload as UserRegisteredPayload);
        return;

      default:
        throw new Error(`Unsupported domain event: ${job.data.eventName}`);
    }
  }

  private async handleUserRegistered(payload: { userId: string; email: string }): Promise<void> {
    await this.emailGateway.send({
      to: payload.email,
      subject: 'Welcome',
      template: EMAIL_TEMPLATE.WELCOME,
      data: {
        email: payload.email,
      },
    });
  }
}
