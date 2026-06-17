import { z } from 'zod';

import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

export const outboxProcessorEnvSchema = z
  .object({
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),
    OUTBOX_LOCK_TTL_MS: z.coerce.number().int().min(1000).default(300_000),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
    OUTBOX_CRON_LOCK_TTL_MS: z.coerce.number().int().min(1000).default(55_000),
    OUTBOX_CONCURRENCY: z.coerce.number().int().min(1).default(1),
    OUTBOX_RETRY_BASE_DELAY_SECONDS: z.coerce.number().int().min(1).default(30),
    OUTBOX_RETRY_MAX_DELAY_SECONDS: z.coerce.number().int().min(1).default(3600),
  })
  .superRefine((env, ctx) => {
    if (env.OUTBOX_CRON_LOCK_TTL_MS >= env.OUTBOX_POLL_INTERVAL_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_CRON_LOCK_TTL_MS'],
        message: 'OUTBOX_CRON_LOCK_TTL_MS must be less than OUTBOX_POLL_INTERVAL_MS',
      });
    }

    if (env.OUTBOX_RETRY_MAX_DELAY_SECONDS < env.OUTBOX_RETRY_BASE_DELAY_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_RETRY_MAX_DELAY_SECONDS'],
        message:
          'OUTBOX_RETRY_MAX_DELAY_SECONDS must be greater than or equal to OUTBOX_RETRY_BASE_DELAY_SECONDS',
      });
    }
  });

export type OutboxProcessorEnv = z.infer<typeof outboxProcessorEnvSchema>;

export function mapOutboxEnvToOptions(env: OutboxProcessorEnv): OutboxProcessorOptions {
  return {
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    lockTtlMs: env.OUTBOX_LOCK_TTL_MS,
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    cronLockTtlMs: env.OUTBOX_CRON_LOCK_TTL_MS,
    concurrency: env.OUTBOX_CONCURRENCY,
    retryDelaySeconds: (attempt: number) =>
      Math.min(
        2 ** attempt * env.OUTBOX_RETRY_BASE_DELAY_SECONDS,
        env.OUTBOX_RETRY_MAX_DELAY_SECONDS,
      ),
  };
}

export function parseOutboxProcessorEnv(env: Record<string, unknown>): OutboxProcessorOptions {
  const parsed = outboxProcessorEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid outbox env: ${parsed.error.message}`);
  }

  return mapOutboxEnvToOptions(parsed.data);
}
