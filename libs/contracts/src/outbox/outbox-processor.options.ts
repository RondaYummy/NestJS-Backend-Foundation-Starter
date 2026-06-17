export interface OutboxProcessorOptions {
  batchSize: number;
  maxAttempts: number;
  lockTtlMs: number;
  pollIntervalMs: number;
  cronLockTtlMs: number;
  concurrency: number;
  retryDelaySeconds: (attempt: number) => number;
}
