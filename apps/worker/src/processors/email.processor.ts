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

    if (
      'idempotencyKey' in payload &&
      payload.idempotencyKey &&
      (await this.executions.isCompleted(payload.idempotencyKey))
    ) {
      return;
    }

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

    if ('idempotencyKey' in payload && payload.idempotencyKey) {
      await this.executions.markCompleted(payload.idempotencyKey, 30 * 24 * 60 * 60);
    }
  }
}
