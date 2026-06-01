import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';

@Processor(QUEUES.EMAIL)
export class EmailProcessor extends WorkerHost {
  constructor(@Inject(TOKENS.EmailGateway) private readonly mail: IEmailGateway) {
    super();
  }
  async process(
    job: Job<{ to: string; subject: string; text?: string; html?: string }>,
  ): Promise<void> {
    await this.mail.send(job.data);
  }
}
