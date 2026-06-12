import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CronModule } from './cron.module';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CronModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(AppLogger));
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
