import { z } from 'zod';

export const JWT_SECRET_MIN_LENGTH = 43;
export const JWT_SECRET_FIELDS = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;
export const JWT_PLACEHOLDER_VALUES = new Set([
  'secret',
  'changeme',
  'development',
  'dev-secret',
  'dev-refresh-secret',
  'dev-access-secret-change-me',
  'dev-refresh-secret-change-me',
]);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional().default(''),
    REDIS_DB: z.coerce.number().default(0),
    REDIS_STARTUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

    REDIS_STARTUP_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),

    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    BULLMQ_DEFAULT_ATTEMPTS: z.coerce.number().default(3),
    BULLMQ_BACKOFF_DELAY: z.coerce.number().default(5000),
    MAIL_DRIVER: z.enum(['smtp', 'null']).default('null'),
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    SMTP_FROM: z.string().default('no-reply@example.com'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_PATH: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional().default(''),
    S3_REGION: z.string().default('eu-central-1'),
    S3_BUCKET: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
    RATE_LIMIT_TTL: z.coerce.number().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().positive().default(100),
    RATE_LIMIT_AUTH_TTL: z.coerce.number().positive().default(60),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().positive().default(5),
    LOGGER_LEVEL: z.string().default('info'),
    AUTH_DRIVER: z.enum(['jwt', 'session']).default('jwt'),
    AUTH_SESSION_TTL_SECONDS: z.coerce.number().default(604800),
    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(1),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    PASSWORD_SALT_ROUNDS: z.coerce.number().default(10),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    AUTH_SESSION_COOKIE_NAME: z.string().min(1).default('sid'),
    AUTH_SESSION_COOKIE_PATH: z.string().min(1).default('/'),
    AUTH_SESSION_COOKIE_DOMAIN: z.string().optional().default(''),
    AUTH_SESSION_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),
    OUTBOX_LOCK_TTL_MS: z.coerce.number().int().min(1000).default(300_000),
    OUTBOX_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(100_000),
    OUTBOX_HANDLER_TIMEOUT_MS: z.coerce.number().int().min(0).default(0),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
    OUTBOX_CRON_LOCK_TTL_MS: z.coerce.number().int().min(1000).default(55_000),
    OUTBOX_CONCURRENCY: z.coerce.number().int().min(1).default(1),
    OUTBOX_RETRY_BASE_DELAY_SECONDS: z.coerce.number().int().min(1).default(30),
    OUTBOX_RETRY_MAX_DELAY_SECONDS: z.coerce.number().int().min(1).default(3600),
    JOB_EXECUTION_LEASE_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
    JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(100),
    JOB_EXECUTION_COMPLETED_RETENTION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .default(2_592_000),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_DRIVER === 'smtp') {
      const required = [
        ['SMTP_HOST', env.SMTP_HOST],
        ['SMTP_USER', env.SMTP_USER],
        ['SMTP_PASSWORD', env.SMTP_PASSWORD],
        ['SMTP_FROM', env.SMTP_FROM],
      ] as const;

      for (const [field, value] of required) {
        if (!value.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when MAIL_DRIVER=smtp`,
          });
        }
      }
    }

    if (env.STORAGE_DRIVER === 's3') {
      const required = [
        ['S3_BUCKET', env.S3_BUCKET],
        ['S3_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID],
        ['S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY],
      ] as const;

      for (const [field, value] of required) {
        if (!value.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }

    if (env.AUTH_SESSION_COOKIE_SAME_SITE === 'none' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SESSION_COOKIE_SAME_SITE'],
        message:
          'SameSite=None requires a Secure cookie and should not be used with the current non-production cookie configuration',
      });
    }

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

    const maxOutboxHeartbeat = Math.floor(env.OUTBOX_LOCK_TTL_MS / 2);

    if (env.OUTBOX_HEARTBEAT_INTERVAL_MS > maxOutboxHeartbeat) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_HEARTBEAT_INTERVAL_MS'],
        message: `OUTBOX_HEARTBEAT_INTERVAL_MS must be less than or equal to ${maxOutboxHeartbeat}`,
      });
    }

    if (
      env.OUTBOX_HANDLER_TIMEOUT_MS > 0 &&
      env.OUTBOX_HANDLER_TIMEOUT_MS < env.OUTBOX_LOCK_TTL_MS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_HANDLER_TIMEOUT_MS'],
        message:
          'OUTBOX_HANDLER_TIMEOUT_MS must be 0 or greater than or equal to OUTBOX_LOCK_TTL_MS',
      });
    }

    const maxJobExecutionHeartbeat = Math.floor(env.JOB_EXECUTION_LEASE_TTL_SECONDS / 2);

    if (env.JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS > maxJobExecutionHeartbeat) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS'],
        message: `JOB_EXECUTION_HEARTBEAT_INTERVAL_SECONDS must be less than or equal to ${maxJobExecutionHeartbeat}`,
      });
    }

    if (env.NODE_ENV === 'production') {
      for (const field of JWT_SECRET_FIELDS) {
        const value = env[field].trim();

        if (
          value.length < JWT_SECRET_MIN_LENGTH ||
          JWT_PLACEHOLDER_VALUES.has(value.toLowerCase())
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} must contain at least 32 bytes of non-placeholder entropy`,
          });
        }
      }

      if (env.JWT_SECRET.trim() === env.JWT_REFRESH_SECRET.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT access and refresh secrets must be different',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
