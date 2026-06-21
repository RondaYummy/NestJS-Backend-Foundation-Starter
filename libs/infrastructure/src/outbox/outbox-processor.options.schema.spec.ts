/// <reference types="jest" />

import {
  computeLockHeartbeatIntervalMs,
  mapOutboxEnvToOptions,
  type OutboxEnvMappingInput,
} from './outbox-processor.options.schema';

const DEFAULT_MAPPING_INPUT: OutboxEnvMappingInput = {
  OUTBOX_BATCH_SIZE: 50,
  OUTBOX_MAX_ATTEMPTS: 10,
  OUTBOX_LOCK_TTL_MS: 300_000,
  OUTBOX_HEARTBEAT_INTERVAL_MS: 100_000,
  OUTBOX_HANDLER_TIMEOUT_MS: 0,
  OUTBOX_POLL_INTERVAL_MS: 60_000,
  OUTBOX_CRON_LOCK_TTL_MS: 55_000,
  OUTBOX_CONCURRENCY: 1,
  OUTBOX_RETRY_BASE_DELAY_SECONDS: 30,
  OUTBOX_RETRY_MAX_DELAY_SECONDS: 3600,
};

describe('mapOutboxEnvToOptions', () => {
  it('maps validated env fields to outbox processor options', () => {
    const options = mapOutboxEnvToOptions(DEFAULT_MAPPING_INPUT);

    expect(options).toEqual({
      batchSize: 50,
      maxAttempts: 10,
      lockTtlMs: 300_000,
      heartbeatIntervalMs: 100_000,
      handlerTimeoutMs: 0,
      pollIntervalMs: 60_000,
      cronLockTtlMs: 55_000,
      concurrency: 1,
      retryDelaySeconds: expect.any(Function),
    });
  });

  it('computes retry delay from base and max delay seconds', () => {
    const options = mapOutboxEnvToOptions({
      ...DEFAULT_MAPPING_INPUT,
      OUTBOX_RETRY_BASE_DELAY_SECONDS: 10,
      OUTBOX_RETRY_MAX_DELAY_SECONDS: 100,
    });

    expect(options.retryDelaySeconds(0)).toBe(10);
    expect(options.retryDelaySeconds(1)).toBe(20);
    expect(options.retryDelaySeconds(10)).toBe(100);
  });

  it('maps env defaults with heartbeat derived from lock ttl', () => {
    const options = mapOutboxEnvToOptions(DEFAULT_MAPPING_INPUT);

    expect(options.heartbeatIntervalMs).toBe(computeLockHeartbeatIntervalMs(300_000));
    expect(options.handlerTimeoutMs).toBe(0);
  });
});

describe('computeLockHeartbeatIntervalMs', () => {
  it('uses one third of lock ttl with a 1 second floor', () => {
    expect(computeLockHeartbeatIntervalMs(300_000)).toBe(100_000);
    expect(computeLockHeartbeatIntervalMs(2000)).toBe(1000);
  });
});
