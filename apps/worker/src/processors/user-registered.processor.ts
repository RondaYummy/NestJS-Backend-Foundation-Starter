import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { QUEUES } from '@contracts/queues/queue-names';
import { HandleUserRegisteredUseCase } from '@application/use-cases/users/emails/handle-user-registered.usecase';
import { IProcessedEventStore } from '@contracts/events/processed-event-store';
import { Inject } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';

type UserRegisteredPayload = {
  userId: string;
  email: string;
};

type OutboxJob = {
  outboxEventId: string;
  eventName: string;
  payload: UserRegisteredPayload;
  occurredAt: string;
};

@Processor(QUEUES.EVENTS)
export class UserRegisteredProcessor extends WorkerHost {
  constructor(
    private readonly handleUserRegistered: HandleUserRegisteredUseCase,

    @Inject(TOKENS.ProcessedEventStore)
    private readonly processedEvents: IProcessedEventStore,
  ) {
    super();
  }

  async process(job: Job<OutboxJob>): Promise<void> {
    await this.processedEvents.executeOnce(
      'user-registered-welcome-email',
      job.data.outboxEventId,
      () => this.handleUserRegistered.execute(job.data.payload),
    );
  }
}
