import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CronModule } from './cron.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CronModule);
  app.enableShutdownHooks();
}
void bootstrap();
