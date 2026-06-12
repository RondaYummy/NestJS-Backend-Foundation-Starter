import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import type { IOutboxProcessor } from '@contracts/outbox/outbox-processor';
import { QUEUES } from '@contracts/queues/queue-names';
import { TOKENS } from '@contracts/tokens';

@Processor(QUEUES.OUTBOX)
export class OutboxProcessor extends WorkerHost {
  constructor(
    @Inject(TOKENS.OutboxProcessor)
    private readonly outbox: IOutboxProcessor,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.outbox.processPending();
  }
}
