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
import { AppConfigService } from '@infrastructure/config/app-config.service';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

@Processor(QUEUES.EMAIL)
export class EmailProcessor extends WorkerHost {
  constructor(
    @Inject(TOKENS.EmailGateway) private readonly mail: IEmailGateway,

    @Inject(TOKENS.JobExecutionStore)
    private readonly executions: IJobExecutionStore,

    private readonly mailTemplates: MailTemplateService,

    private readonly config: AppConfigService,

    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    const payload = job.data;
    const idempotencyKey =
      'idempotencyKey' in payload && payload.idempotencyKey ? payload.idempotencyKey : null;

    const jobExecution = this.config.jobExecution();
    const { leaseTtlSeconds, heartbeatIntervalSeconds, completedRetentionTtlSeconds } =
      jobExecution;

    let ownershipToken: string | null = null;
    let ownershipLost = false;
    let heartbeatInProgress = false;
    let heartbeat: NodeJS.Timeout | undefined;

    if (idempotencyKey) {
      ownershipToken = await this.executions.acquire(idempotencyKey, leaseTtlSeconds);

      if (!ownershipToken) {
        return;
      }

      heartbeat = setInterval(() => {
        if (heartbeatInProgress || ownershipLost) {
          return;
        }

        heartbeatInProgress = true;

        void this.executions
          .extend(idempotencyKey, ownershipToken!, leaseTtlSeconds)
          .then((extended) => {
            if (!extended) {
              ownershipLost = true;
            }
          })
          .catch(() => {
            ownershipLost = true;
          })
          .finally(() => {
            heartbeatInProgress = false;
          });
      }, heartbeatIntervalSeconds * 1000);

      heartbeat.unref();
    }

    try {
      if (isTemplatedEmailJob(payload)) {
        const { html, text } = await this.mailTemplates.render(payload.template, payload.data);

        if (ownershipLost) {
          this.logger.warn('Job execution ownership lost before email send', {
            idempotencyKey,
            jobId: job.id,
          });
          throw new Error('Job execution ownership was lost before email send');
        }

        await this.mail.send({
          to: payload.to,
          subject: payload.subject,
          html,
          text,
        });
      } else {
        if (ownershipLost) {
          this.logger.warn('Job execution ownership lost before email send', {
            idempotencyKey,
            jobId: job.id,
          });
          throw new Error('Job execution ownership was lost before email send');
        }

        await this.mail.send(payload);
      }

      if (idempotencyKey && ownershipToken) {
        await this.executions.complete(
          idempotencyKey,
          ownershipToken,
          completedRetentionTtlSeconds,
        );
      }
    } catch (error) {
      if (idempotencyKey && ownershipToken) {
        await this.executions.release(idempotencyKey, ownershipToken);
      }

      throw error;
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }
}
