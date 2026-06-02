import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { EmailJobPayload } from '@contracts/mail/email-job';
import { isTemplatedEmailJob } from '@contracts/mail/email-job';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { MailTemplateService } from '@infrastructure/mail/mail-template.service';

@Processor(QUEUES.EMAIL)
export class EmailProcessor extends WorkerHost {
  constructor(
    @Inject(TOKENS.EmailGateway) private readonly mail: IEmailGateway,
    private readonly mailTemplates: MailTemplateService,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    const payload = job.data;

    if (isTemplatedEmailJob(payload)) {
      const { html, text } = await this.mailTemplates.render(payload.template, payload.data);
      await this.mail.send({
        to: payload.to,
        subject: payload.subject,
        html,
        text,
      });
      return;
    }

    await this.mail.send(payload);
  }
}
