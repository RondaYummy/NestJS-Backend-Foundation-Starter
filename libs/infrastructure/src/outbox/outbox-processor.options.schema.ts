import type { OutboxProcessorOptions } from '@contracts/outbox/outbox-processor.options';

export function computeLockHeartbeatIntervalMs(lockTtlMs: number): number {
  return Math.max(Math.floor(lockTtlMs / 3), 1000);
}

export interface OutboxEnvMappingInput {
  OUTBOX_BATCH_SIZE: number;
  OUTBOX_MAX_ATTEMPTS: number;
  OUTBOX_LOCK_TTL_MS: number;
  OUTBOX_HEARTBEAT_INTERVAL_MS: number;
  OUTBOX_HANDLER_TIMEOUT_MS: number;
  OUTBOX_POLL_INTERVAL_MS: number;
  OUTBOX_CRON_LOCK_TTL_MS: number;
  OUTBOX_CONCURRENCY: number;
  OUTBOX_RETRY_BASE_DELAY_SECONDS: number;
  OUTBOX_RETRY_MAX_DELAY_SECONDS: number;
}

export function mapOutboxEnvToOptions(env: OutboxEnvMappingInput): OutboxProcessorOptions {
  return {
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    lockTtlMs: env.OUTBOX_LOCK_TTL_MS,
    heartbeatIntervalMs: env.OUTBOX_HEARTBEAT_INTERVAL_MS,
    handlerTimeoutMs: env.OUTBOX_HANDLER_TIMEOUT_MS,
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
