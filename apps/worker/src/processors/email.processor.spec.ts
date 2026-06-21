/// <reference types="jest" />

import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';

import type { EmailJobPayload } from '@contracts/mail/email-job';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import type { IJobExecutionStore } from '@contracts/idempotency/job-execution-store';
import type { JobExecutionOptions } from '@contracts/idempotency/job-execution.options';
import { ExecutionOwnershipLostError } from '@infrastructure/idempotency/job-execution.errors';
import type { MailTemplateService } from '@infrastructure/mail/mail-template.service';
import type { AppConfigService } from '@infrastructure/config/app-config.service';
import type { AppLogger } from '@infrastructure/logger/app-logger.service';

import { EmailProcessor } from './email.processor';

const TEST_JOB_EXECUTION_OPTIONS: JobExecutionOptions = {
  leaseTtlSeconds: 300,
  heartbeatIntervalSeconds: 60,
  completedRetentionTtlSeconds: 2_592_000,
};

function buildJob(payload: EmailJobPayload, jobId = 'job-1'): Job<EmailJobPayload> {
  return { id: jobId, data: payload } as Job<EmailJobPayload>;
}

describe('EmailProcessor', () => {
  let executions: jest.Mocked<IJobExecutionStore>;
  let mailGateway: jest.Mocked<IEmailGateway>;
  let mailTemplates: jest.Mocked<Pick<MailTemplateService, 'render'>>;
  let config: Pick<AppConfigService, 'jobExecution'>;
  let logger: jest.Mocked<Pick<AppLogger, 'warn'>>;
  let processor: EmailProcessor;

  beforeEach(() => {
    jest.useFakeTimers();

    executions = {
      acquire: jest.fn(),
      extend: jest.fn(),
      complete: jest.fn(),
      release: jest.fn(),
      markAmbiguousSent: jest.fn(),
    };

    mailGateway = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    mailTemplates = {
      render: jest.fn(),
    };

    config = {
      jobExecution: () => TEST_JOB_EXECUTION_OPTIONS,
    };

    logger = {
      warn: jest.fn(),
    };

    processor = new EmailProcessor(
      mailGateway,
      executions,
      mailTemplates,
      config as AppConfigService,
      logger as unknown as AppLogger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws UnrecoverableError and marks ambiguous sent when complete returns false after send', async () => {
    const idempotencyKey = 'welcome:user-1';
    const ownershipToken = 'token-a';

    executions.acquire.mockResolvedValue(ownershipToken);
    executions.complete.mockResolvedValue(false);

    const payload: EmailJobPayload = {
      to: 'recipient@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
      idempotencyKey,
    };

    await expect(processor.process(buildJob(payload))).rejects.toBeInstanceOf(UnrecoverableError);

    expect(mailGateway.send).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '<welcome-user-1@idempotency>',
      }),
    );
    expect(executions.markAmbiguousSent).toHaveBeenCalledWith(
      idempotencyKey,
      TEST_JOB_EXECUTION_OPTIONS.completedRetentionTtlSeconds,
    );
    expect(executions.release).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Job execution ownership lost after email send',
      expect.objectContaining({
        idempotencyKey,
        jobId: 'job-1',
        reason: 'complete-returned-false',
      }),
    );
  });

  it('throws UnrecoverableError when ownership is lost before complete after send', async () => {
    const idempotencyKey = 'welcome:user-2';
    const ownershipToken = 'token-b';
    let resolveSend: () => void;

    executions.acquire.mockResolvedValue(ownershipToken);
    executions.extend.mockResolvedValue(false);
    mailGateway.send.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    const payload: EmailJobPayload = {
      to: 'recipient@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
      idempotencyKey,
    };

    const processPromise = processor.process(buildJob(payload, 'job-2'));

    await jest.advanceTimersByTimeAsync(TEST_JOB_EXECUTION_OPTIONS.heartbeatIntervalSeconds * 1000);
    resolveSend!();

    await expect(processPromise).rejects.toBeInstanceOf(UnrecoverableError);

    expect(executions.markAmbiguousSent).toHaveBeenCalledWith(
      idempotencyKey,
      TEST_JOB_EXECUTION_OPTIONS.completedRetentionTtlSeconds,
    );
    expect(executions.complete).not.toHaveBeenCalled();
    expect(executions.release).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Job execution ownership lost after email send',
      expect.objectContaining({
        idempotencyKey,
        reason: 'ownership-lost-before-complete',
      }),
    );
  });

  it('releases ownership and throws ExecutionOwnershipLostError on pre-send ownership loss', async () => {
    const idempotencyKey = 'welcome:user-3';
    const ownershipToken = 'token-c';
    let resolveRender: (value: { html: string; text: string }) => void;

    executions.acquire.mockResolvedValue(ownershipToken);
    executions.extend.mockResolvedValue(false);
    mailTemplates.render.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRender = resolve;
        }),
    );

    const payload: EmailJobPayload = {
      to: 'recipient@example.com',
      subject: 'Welcome',
      template: 'welcome',
      data: { email: 'ada@example.com' },
      idempotencyKey,
    };

    const processPromise = processor.process(buildJob(payload, 'job-3'));

    await jest.advanceTimersByTimeAsync(TEST_JOB_EXECUTION_OPTIONS.heartbeatIntervalSeconds * 1000);
    resolveRender!({ html: '<p>Hello</p>', text: 'Hello' });

    await expect(processPromise).rejects.toBeInstanceOf(ExecutionOwnershipLostError);
    await expect(processPromise).rejects.not.toBeInstanceOf(UnrecoverableError);

    expect(mailGateway.send).not.toHaveBeenCalled();
    expect(executions.release).toHaveBeenCalledWith(idempotencyKey, ownershipToken);
    expect(executions.markAmbiguousSent).not.toHaveBeenCalled();
  });

  it('releases ownership when send fails before side effect is committed', async () => {
    const idempotencyKey = 'welcome:user-4';
    const ownershipToken = 'token-d';

    executions.acquire.mockResolvedValue(ownershipToken);
    mailGateway.send.mockRejectedValue(new Error('smtp failed'));

    const payload: EmailJobPayload = {
      to: 'recipient@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
      idempotencyKey,
    };

    await expect(processor.process(buildJob(payload, 'job-4'))).rejects.toThrow('smtp failed');

    expect(executions.release).toHaveBeenCalledWith(idempotencyKey, ownershipToken);
    expect(executions.markAmbiguousSent).not.toHaveBeenCalled();
  });
});
