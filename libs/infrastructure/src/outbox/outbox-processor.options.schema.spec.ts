/// <reference types="jest" />

import {
  computeHandlerTimeoutMs,
  computeLockHeartbeatIntervalMs,
  mapOutboxEnvToOptions,
  outboxProcessorEnvSchema,
} from './outbox-processor.options.schema';

describe('outboxProcessorEnvSchema', () => {
  it('accepts default-compatible values', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({});

    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data).toEqual({
        OUTBOX_BATCH_SIZE: 50,
        OUTBOX_MAX_ATTEMPTS: 10,
        OUTBOX_LOCK_TTL_MS: 300_000,
        OUTBOX_POLL_INTERVAL_MS: 60_000,
        OUTBOX_CRON_LOCK_TTL_MS: 55_000,
        OUTBOX_CONCURRENCY: 1,
        OUTBOX_RETRY_BASE_DELAY_SECONDS: 30,
        OUTBOX_RETRY_MAX_DELAY_SECONDS: 3600,
      });
    }
  });

  it('maps computed heartbeat and handler timeout defaults from lock ttl', () => {
    const options = mapOutboxEnvToOptions(
      outboxProcessorEnvSchema.parse({
        OUTBOX_LOCK_TTL_MS: 300_000,
      }),
    );

    expect(options.lockHeartbeatIntervalMs).toBe(computeLockHeartbeatIntervalMs(300_000));
    expect(options.handlerTimeoutMs).toBe(computeHandlerTimeoutMs(300_000));
  });

  it('rejects cron lock ttl greater than or equal to poll interval', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({
      OUTBOX_POLL_INTERVAL_MS: 60_000,
      OUTBOX_CRON_LOCK_TTL_MS: 60_000,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects batch size below 1', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({
      OUTBOX_BATCH_SIZE: 0,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects retry max delay below base delay', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({
      OUTBOX_RETRY_BASE_DELAY_SECONDS: 120,
      OUTBOX_RETRY_MAX_DELAY_SECONDS: 60,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects heartbeat interval above half of lock ttl', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({
      OUTBOX_LOCK_TTL_MS: 3000,
      OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS: 2000,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects handler timeout below lock ttl', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({
      OUTBOX_LOCK_TTL_MS: 5000,
      OUTBOX_HANDLER_TIMEOUT_MS: 4000,
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts explicit heartbeat and handler timeout within bounds', () => {
    const parsed = outboxProcessorEnvSchema.safeParse({
      OUTBOX_LOCK_TTL_MS: 6000,
      OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS: 2000,
      OUTBOX_HANDLER_TIMEOUT_MS: 8000,
    });

    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const options = mapOutboxEnvToOptions(parsed.data);

      expect(options.lockHeartbeatIntervalMs).toBe(2000);
      expect(options.handlerTimeoutMs).toBe(8000);
    }
  });
});
