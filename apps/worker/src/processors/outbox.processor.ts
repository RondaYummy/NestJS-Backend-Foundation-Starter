import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '@contracts/queues/queue-names';
import { OutboxService } from '@infrastructure/outbox/outbox.service';

@Processor(QUEUES.OUTBOX)
export class OutboxProcessor extends WorkerHost {
  constructor(private readonly outbox: OutboxService) {
    super();
  }
  async process(_job: Job): Promise<void> {
    await this.outbox.processPending();
  }
}
