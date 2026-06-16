import 'reflect-metadata';
import cookieParser from 'cookie-parser';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigService } from '@infrastructure/config/app-config.service';

import { ApiModule } from './api.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bufferLogs: true,
  });

  app.set('trust proxy', 1);
  app.use(cookieParser());

  app.enableShutdownHooks();

  app.useLogger(app.get(AppLogger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(AppConfigService);

  const allowedOrigins = config
    .app()
    .allowedOrigins.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed'));
    },
    credentials: true,
  });

  await app.listen(config.app().port);
}

void bootstrap();
