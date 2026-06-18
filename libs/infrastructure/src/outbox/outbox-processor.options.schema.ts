import { z } from 'zod';

import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

export function computeLockHeartbeatIntervalMs(lockTtlMs: number): number {
  return Math.max(Math.floor(lockTtlMs / 3), 1000);
}

export function computeHandlerTimeoutMs(lockTtlMs: number): number {
  return lockTtlMs;
}

export const outboxProcessorEnvSchema = z
  .object({
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),
    OUTBOX_LOCK_TTL_MS: z.coerce.number().int().min(1000).default(300_000),
    OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).optional(),
    OUTBOX_HANDLER_TIMEOUT_MS: z.coerce.number().int().min(1000).optional(),
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

    const lockTtlMs = env.OUTBOX_LOCK_TTL_MS;
    const maxHeartbeat = Math.floor(lockTtlMs / 2);
    const heartbeat =
      env.OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS ?? computeLockHeartbeatIntervalMs(lockTtlMs);
    const handlerTimeout = env.OUTBOX_HANDLER_TIMEOUT_MS ?? computeHandlerTimeoutMs(lockTtlMs);

    if (heartbeat > maxHeartbeat) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS'],
        message: `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS must be less than or equal to ${maxHeartbeat}`,
      });
    }

    if (handlerTimeout < lockTtlMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_HANDLER_TIMEOUT_MS'],
        message: 'OUTBOX_HANDLER_TIMEOUT_MS must be greater than or equal to OUTBOX_LOCK_TTL_MS',
      });
    }
  });

export type OutboxProcessorEnv = z.infer<typeof outboxProcessorEnvSchema>;

export function mapOutboxEnvToOptions(env: OutboxProcessorEnv): OutboxProcessorOptions {
  const lockTtlMs = env.OUTBOX_LOCK_TTL_MS;

  return {
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    lockTtlMs,
    lockHeartbeatIntervalMs:
      env.OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS ?? computeLockHeartbeatIntervalMs(lockTtlMs),
    handlerTimeoutMs: env.OUTBOX_HANDLER_TIMEOUT_MS ?? computeHandlerTimeoutMs(lockTtlMs),
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
