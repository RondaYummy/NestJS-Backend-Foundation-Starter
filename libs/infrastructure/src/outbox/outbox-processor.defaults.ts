import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

export function defaultRetryDelaySeconds(attempt: number): number {
  return Math.min(2 ** attempt * 30, 3600);
}

export const OUTBOX_PROCESSOR_DEFAULT_OPTIONS: OutboxProcessorOptions = {
  batchSize: 50,
  maxAttempts: 10,
  lockTtlMs: 5 * 60 * 1000,
  heartbeatIntervalMs: 100_000,
  handlerTimeoutMs: 0,
  pollIntervalMs: 60_000,
  cronLockTtlMs: 55_000,
  concurrency: 1,
  retryDelaySeconds: defaultRetryDelaySeconds,
};
