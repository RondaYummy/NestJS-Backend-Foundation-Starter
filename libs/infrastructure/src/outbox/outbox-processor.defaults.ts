import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

import {
  computeHandlerTimeoutMs,
  computeLockHeartbeatIntervalMs,
  mapOutboxEnvToOptions,
  outboxProcessorEnvSchema,
} from './outbox-processor.options.schema';

export function defaultRetryDelaySeconds(attempt: number): number {
  return Math.min(2 ** attempt * 30, 3600);
}

const defaultLockTtlMs = 5 * 60 * 1000;

export const OUTBOX_PROCESSOR_DEFAULT_OPTIONS: OutboxProcessorOptions = {
  batchSize: 50,
  maxAttempts: 10,
  lockTtlMs: defaultLockTtlMs,
  lockHeartbeatIntervalMs: computeLockHeartbeatIntervalMs(defaultLockTtlMs),
  handlerTimeoutMs: computeHandlerTimeoutMs(defaultLockTtlMs),
  pollIntervalMs: 60_000,
  cronLockTtlMs: 55_000,
  concurrency: 1,
  retryDelaySeconds: defaultRetryDelaySeconds,
};

export function buildOutboxProcessorDecoratorOptions(): { concurrency: number } {
  return {
    concurrency: resolveOutboxOptionsFromEnv().concurrency,
  };
}

export function resolveOutboxOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OutboxProcessorOptions {
  const parsed = outboxProcessorEnvSchema.safeParse(env);

  if (!parsed.success) {
    return OUTBOX_PROCESSOR_DEFAULT_OPTIONS;
  }

  return mapOutboxEnvToOptions(parsed.data);
}
