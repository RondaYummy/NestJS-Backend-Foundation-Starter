import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import type { EmailJobPayload } from '@contracts/mail/email-job';
import { isTemplatedEmailJob } from '@contracts/mail/email-job';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import { TOKENS } from '@contracts/tokens';
import { QUEUES } from '@contracts/queues/queue-names';
import { MailTemplateService } from '@infrastructure/mail/mail-template.service';
import type { IJobExecutionStore } from '@contracts/idempotency/job-execution-store';
import { ExecutionOwnershipLostError } from '@infrastructure/idempotency/job-execution.errors';
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
    let sideEffectCommitted = false;
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
      const messageId = idempotencyKey ? this.formatMessageId(idempotencyKey) : undefined;

      if (isTemplatedEmailJob(payload)) {
        const { html, text } = await this.mailTemplates.render(payload.template, payload.data);

        this.assertOwnershipBeforeSend(idempotencyKey, job, ownershipLost);

        await this.mail.send({
          to: payload.to,
          subject: payload.subject,
          html,
          text,
          messageId,
        });
      } else {
        this.assertOwnershipBeforeSend(idempotencyKey, job, ownershipLost);

        await this.mail.send({
          ...payload,
          messageId,
        });
      }

      sideEffectCommitted = true;

      if (idempotencyKey && ownershipToken) {
        if (ownershipLost) {
          await this.handlePostSendCompletionFailure(
            idempotencyKey,
            job,
            'ownership-lost-before-complete',
            completedRetentionTtlSeconds,
          );
        }

        const completed = await this.executions.complete(
          idempotencyKey,
          ownershipToken,
          completedRetentionTtlSeconds,
        );

        if (!completed) {
          await this.handlePostSendCompletionFailure(
            idempotencyKey,
            job,
            'complete-returned-false',
            completedRetentionTtlSeconds,
          );
        }
      }
    } catch (error) {
      if (idempotencyKey && ownershipToken && !sideEffectCommitted) {
        await this.executions.release(idempotencyKey, ownershipToken);
      }

      throw error;
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  private assertOwnershipBeforeSend(
    idempotencyKey: string | null,
    job: Job<EmailJobPayload>,
    ownershipLost: boolean,
  ): void {
    if (!ownershipLost) {
      return;
    }

    this.logger.warn('Job execution ownership lost before email send', {
      idempotencyKey,
      jobId: job.id,
    });

    throw new ExecutionOwnershipLostError({
      phase: 'before-send',
      idempotencyKey: idempotencyKey ?? 'unknown',
      jobId: String(job.id),
      reason: 'ownership-lost-before-send',
    });
  }

  private formatMessageId(idempotencyKey: string): string {
    const sanitized = idempotencyKey.replace(/[^a-zA-Z0-9._@-]/g, '-');

    return `<${sanitized}@idempotency>`;
  }

  private async handlePostSendCompletionFailure(
    idempotencyKey: string,
    job: Job<EmailJobPayload>,
    reason: string,
    completedRetentionTtlSeconds: number,
  ): Promise<never> {
    this.logger.warn('Job execution ownership lost after email send', {
      idempotencyKey,
      jobId: job.id,
      reason,
    });

    try {
      await this.executions.markAmbiguousSent(idempotencyKey, completedRetentionTtlSeconds);
    } catch (markerError) {
      this.logger.warn('Failed to write ambiguous sent marker after email send', {
        idempotencyKey,
        jobId: job.id,
        reason,
        error: markerError instanceof Error ? markerError.message : String(markerError),
      });
    }

    throw new UnrecoverableError(
      new ExecutionOwnershipLostError({
        phase: 'after-send',
        idempotencyKey,
        jobId: String(job.id),
        reason,
      }).message,
    );
  }
}
