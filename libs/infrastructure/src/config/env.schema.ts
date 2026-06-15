import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional().default(''),
    REDIS_DB: z.coerce.number().default(0),
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
  });

export type Env = z.infer<typeof envSchema>;
