import 'reflect-metadata';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { assertRedisAvailable } from '@infrastructure/redis/assert-redis-available';
import { getRedisStartupConfig } from '@infrastructure/redis/redis-startup-config';

import { WorkerModule } from './worker.module';

let application: INestApplicationContext | undefined;

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
};

async function bootstrap(): Promise<void> {
  /*
   * Перевірка виконується ДО NestFactory.createApplicationContext().
   *
   * Тому BullMQ processors ще не створені й не можуть відкрити
   * нескінченні reconnect connections.
   */
  await assertRedisAvailable(getRedisStartupConfig());

  application = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  const logger = application.get(AppLogger);

  application.useLogger(logger);
  application.enableShutdownHooks();

  logger.log('Worker application started successfully');
}

async function shutdownAfterStartupFailure(error: unknown): Promise<never> {
  console.error('[worker-startup] Worker failed to start');
  console.error(formatError(error));

  if (application) {
    try {
      await application.close();
    } catch (closeError: unknown) {
      console.error('[worker-startup] Failed to close application context');
      console.error(formatError(closeError));
    }
  }

  /*
   * Тут потрібен саме process.exit(1), а не process.exitCode = 1.
   *
   * process.exitCode лише задає код майбутнього завершення.
   * Якщо ioredis або BullMQ залишили active handles, Node.js продовжить
   * працювати й процес не завершиться.
   */
  process.exit(1);
}

void bootstrap().catch(shutdownAfterStartupFailure);
