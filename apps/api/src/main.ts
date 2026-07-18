import 'reflect-metadata';
import cookieParser from 'cookie-parser';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigService } from '@infrastructure/config/app-config.service';

import { ApiModule } from './api.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { assertRedisAvailable } from '@infrastructure/redis/assert-redis-available';
import { getRedisStartupConfig } from '@infrastructure/redis/redis-startup-config';
import { SwaggerModule } from '@nestjs/swagger';
import {
  API_DOCS_JSON_PATH,
  API_DOCS_PATH,
  createOpenApiDocument,
} from './openapi/create-openapi-document';

let application: NestExpressApplication | undefined;

async function bootstrap(): Promise<void> {
  await assertRedisAvailable(getRedisStartupConfig());

  application = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bufferLogs: true,
  });

  application.set('trust proxy', 1);
  application.use(cookieParser());

  application.enableShutdownHooks();

  application.useLogger(application.get(AppLogger));

  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = application.get(AppConfigService);
  const logger = application.get(AppLogger);

  if (config.app().apiDocsEnabled) {
    const document = createOpenApiDocument(application, config.auth().sessionCookieName);
    SwaggerModule.setup(API_DOCS_PATH, application, document);
    logger.info('API documentation enabled', {
      swaggerUi: `/${API_DOCS_PATH}`,
      openApiJson: `/${API_DOCS_JSON_PATH}`,
    });
  } else {
    logger.info('API documentation disabled');
  }

  const allowedOrigins = config
    .app()
    .allowedOrigins.split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);

  application.enableCors({
    origin(origin: string | undefined, callback: (err: Error | null, success: boolean) => void) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed'), false);
    },
    credentials: true,
  });

  await application.listen(config.app().port);
}

void bootstrap().catch(async (error: unknown) => {
  console.error('[api-startup] API failed to start', error);

  if (application) {
    await application.close().catch(() => undefined);
  }

  process.exit(1);
});
