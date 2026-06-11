import 'reflect-metadata';
import cookieParser from 'cookie-parser';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigService } from '@infrastructure/config/app-config.service';

import { ApiModule } from './api.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule, {
    bufferLogs: true,
  });

  app.use(cookieParser());

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const config = app.get(AppConfigService);

  await app.listen(config.getNumber('app.port'));
}

void bootstrap();
