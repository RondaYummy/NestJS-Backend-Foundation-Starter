import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(AppLogger));
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
