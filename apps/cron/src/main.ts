import 'reflect-metadata';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { assertRedisAvailable } from '@infrastructure/redis/assert-redis-available';
import { getRedisStartupConfig } from '@infrastructure/redis/redis-startup-config';

import { CronModule } from './cron.module';

let application: INestApplicationContext | undefined;

async function bootstrap(): Promise<void> {
  await assertRedisAvailable(getRedisStartupConfig());

  application = await NestFactory.createApplicationContext(CronModule, {
    bufferLogs: true,
  });

  application.useLogger(application.get(AppLogger));
  application.enableShutdownHooks();
}

void bootstrap().catch(async (error: unknown) => {
  console.error('[cron-startup] Cron failed to start', error);

  if (application) {
    try {
      await application.close();
    } catch (closeError: unknown) {
      console.error('[cron-startup] Failed to close application', closeError);
    }
  }

  process.exit(1);
});
