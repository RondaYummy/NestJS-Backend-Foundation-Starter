import { z } from 'zod';
import type { RedisStartupCheckOptions } from './assert-redis-available';

const redisStartupEnvSchema = z.object({
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),

  REDIS_STARTUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  REDIS_STARTUP_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),

  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

export function getRedisStartupConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RedisStartupCheckOptions {
  const env = redisStartupEnvSchema.parse(environment);

  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,

    maxAttempts: env.REDIS_STARTUP_MAX_ATTEMPTS,
    retryDelayMs: env.REDIS_STARTUP_RETRY_DELAY_MS,
    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
  };
}
