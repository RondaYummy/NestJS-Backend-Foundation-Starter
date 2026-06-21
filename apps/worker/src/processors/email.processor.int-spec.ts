/// <reference types="jest" />

import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';
import type { Job } from 'bullmq';

import type { EmailJobPayload } from '@contracts/mail/email-job';
import type { IEmailGateway } from '@contracts/mail/email-gateway';
import type { JobExecutionOptions } from '@contracts/idempotency/job-execution.options';
import { EmailProcessor } from './email.processor';
import { RedisJobExecutionStore } from '@infrastructure/idempotency/redis-job-execution.store';
import { RedisService } from '@infrastructure/redis/redis.service';
import type { MailTemplateService } from '@infrastructure/mail/mail-template.service';
import type { AppConfigService } from '@infrastructure/config/app-config.service';
import type { AppLogger } from '@infrastructure/logger/app-logger.service';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);

const TEST_JOB_EXECUTION_OPTIONS: JobExecutionOptions = {
  leaseTtlSeconds: 2,
  heartbeatIntervalSeconds: 1,
  completedRetentionTtlSeconds: 60,
};

async function isRedisAvailable(): Promise<boolean> {
  const client = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    db: REDIS_DB,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  try {
    await client.connect();
    await client.ping();
    await client.quit();
    return true;
  } catch {
    try {
      await client.quit();
    } catch {
      // ignore cleanup errors when Redis is unavailable
    }

    return false;
  }
}

function buildJob(payload: EmailJobPayload): Job<EmailJobPayload> {
  return { data: payload } as Job<EmailJobPayload>;
}

describe('EmailProcessor integration (V-03)', () => {
  let redisAvailable = false;
  let redisClient: Redis;
  let executionStore: RedisJobExecutionStore;
  let sendDelayMs: number;
  let sendCount: number;
  let mailGateway: IEmailGateway;
  let config: Pick<AppConfigService, 'jobExecution'>;
  let processor: EmailProcessor;

  beforeAll(async () => {
    redisAvailable = await isRedisAvailable();

    if (!redisAvailable) {
      console.warn(
        `Skipping EmailProcessor integration tests: Redis unavailable at ${REDIS_HOST}:${REDIS_PORT}`,
      );
    }
  });

  beforeEach(() => {
    if (!redisAvailable) {
      return;
    }

    redisClient = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      maxRetriesPerRequest: null,
    });

    executionStore = new RedisJobExecutionStore(new RedisService(redisClient));
    sendDelayMs = 5_000;
    sendCount = 0;

    mailGateway = {
      send: jest.fn(() => {
        sendCount += 1;
        return new Promise<void>((resolve) => {
          setTimeout(resolve, sendDelayMs);
        });
      }),
    };

    config = {
      jobExecution: () => TEST_JOB_EXECUTION_OPTIONS,
    };

    const mailTemplates = {
      render: jest.fn(),
    } as unknown as MailTemplateService;

    const logger = {
      warn: jest.fn(),
    } as unknown as AppLogger;

    processor = new EmailProcessor(
      mailGateway,
      executionStore,
      mailTemplates,
      config as AppConfigService,
      logger,
    );
  });

  afterEach(async () => {
    if (!redisAvailable) {
      return;
    }

    const keys = await redisClient.keys('job-execution:*');

    if (keys.length > 0) {
      await redisClient.del(...keys);
    }

    await redisClient.quit();
  });

  it('allows only one gateway send when a duplicate delivery overlaps a long-running job', async () => {
    if (!redisAvailable) {
      return;
    }

    const idempotencyKey = `v03-${randomUUID()}`;
    const payload: EmailJobPayload = {
      to: 'recipient@example.com',
      subject: 'Heartbeat test',
      html: '<p>test</p>',
      idempotencyKey,
    };

    const firstRun = processor.process(buildJob(payload));

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const secondRun = processor.process(buildJob(payload));

    await Promise.allSettled([firstRun, secondRun]);

    expect(sendCount).toBe(1);
    expect(mailGateway.send).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('blocks duplicate send after post-send complete failure writes sent-ambiguous marker', async () => {
    if (!redisAvailable) {
      return;
    }

    const idempotencyKey = `post-send-complete-failure-${randomUUID()}`;
    const payload: EmailJobPayload = {
      to: 'recipient@example.com',
      subject: 'Post-send complete failure',
      html: '<p>test</p>',
      idempotencyKey,
    };

    mailGateway = {
      send: jest.fn(async () => {
        sendCount += 1;
        await redisClient.set(`job-execution:${idempotencyKey}`, 'stale-token', 'EX', 60);
      }),
    };

    const mailTemplates = {
      render: jest.fn(),
    } as MailTemplateService;

    processor = new EmailProcessor(
      mailGateway,
      executionStore,
      mailTemplates,
      config as AppConfigService,
      {
        warn: jest.fn(),
      } as unknown as AppLogger,
    );

    await expect(processor.process(buildJob(payload))).rejects.toThrow();

    const marker = await redisClient.get(`job-execution:${idempotencyKey}`);
    expect(marker).toBe('sent-ambiguous');

    await processor.process(buildJob(payload));

    expect(sendCount).toBe(1);
    expect(mailGateway.send).toHaveBeenCalledTimes(1);
  });
});
