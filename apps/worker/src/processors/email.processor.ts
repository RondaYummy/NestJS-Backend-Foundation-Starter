import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { EmailJobPayload } from '@contracts/mail/email-job';
import { isTemplatedEmailJob } from '@contracts/mail/email-job';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { MailTemplateService } from '@infrastructure/mail/mail-template.service';
import type { IJobExecutionStore } from '@contracts/idempotency/job-execution-store';

const COMPLETED_RETENTION_TTL_SECONDS = 30 * 24 * 60 * 60;
const EXECUTION_TTL_SECONDS = 300;

@Processor(QUEUES.EMAIL)
export class EmailProcessor extends WorkerHost {
  constructor(
    @Inject(TOKENS.EmailGateway) private readonly mail: IEmailGateway,

    @Inject(TOKENS.JobExecutionStore)
    private readonly executions: IJobExecutionStore,

    private readonly mailTemplates: MailTemplateService,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    const payload = job.data;
    const idempotencyKey =
      'idempotencyKey' in payload && payload.idempotencyKey ? payload.idempotencyKey : null;

    let ownershipToken: string | null = null;

    if (idempotencyKey) {
      ownershipToken = await this.executions.acquire(idempotencyKey, EXECUTION_TTL_SECONDS);

      if (!ownershipToken) {
        return;
      }
    }

    try {
      if (isTemplatedEmailJob(payload)) {
        const { html, text } = await this.mailTemplates.render(payload.template, payload.data);

        await this.mail.send({
          to: payload.to,
          subject: payload.subject,
          html,
          text,
        });
      } else {
        await this.mail.send(payload);
      }

      if (idempotencyKey && ownershipToken) {
        await this.executions.complete(
          idempotencyKey,
          ownershipToken,
          COMPLETED_RETENTION_TTL_SECONDS,
        );
      }
    } catch (error) {
      if (idempotencyKey && ownershipToken) {
        await this.executions.release(idempotencyKey, ownershipToken);
      }

      throw error;
    }
  }
}
