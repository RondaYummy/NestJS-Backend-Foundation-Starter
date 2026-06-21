import type { RedisOptions } from 'ioredis';
import Redis from 'ioredis';

export type RedisStartupCheckOptions = {
  host: string;
  port: number;
  password?: string;
  db: number;

  maxAttempts: number;
  retryDelayMs: number;
  connectTimeoutMs: number;
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

/**
 * Перевіряє Redis до створення Nest application context.
 *
 * Важливо:
 * - цей client використовується тільки для startup check;
 * - він не має нескінченного reconnect;
 * - runtime Redis/BullMQ clients створюються окремо Nest-модулями.
 */
export async function assertRedisAvailable(options: RedisStartupCheckOptions): Promise<void> {
  const { maxAttempts, retryDelayMs, connectTimeoutMs, ...connectionOptions } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const redisOptions: RedisOptions = {
      ...connectionOptions,

      lazyConnect: true,

      // Startup probe сам контролює кількість спроб.
      retryStrategy: () => null,

      // Не накопичувати команди, коли Redis недоступний.
      enableOfflineQueue: false,

      // Максимальний час одного TCP connection attempt.
      connectTimeout: connectTimeoutMs,

      // Одна невдала команда одразу повинна повернути помилку.
      maxRetriesPerRequest: 0,
    };

    const client = new Redis(redisOptions);

    // ioredis emit('error') не повинен залишитися без listener.
    client.on('error', () => undefined);

    try {
      await client.connect();

      const response = await client.ping();

      if (response !== 'PONG') {
        throw new Error(`Unexpected Redis PING response: ${response}`);
      }

      // З'єднання probe більше не потрібне.
      await client.quit();

      console.info(`[redis-startup] Redis is available at ${options.host}:${options.port}`);

      return;
    } catch (error: unknown) {
      lastError = error;

      // disconnect() не очікує відповіді Redis і безпечно
      // завершує навіть напіввідкрите connection.
      client.disconnect();

      console.error(
        `[redis-startup] Redis connection attempt ${attempt}/${maxAttempts} failed: ${toErrorMessage(
          error,
        )}`,
      );

      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(
    `Redis is unavailable after ${maxAttempts} startup attempts: ${toErrorMessage(lastError)}`,
    {
      cause: lastError,
    },
  );
}
