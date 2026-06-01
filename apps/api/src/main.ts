import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule, { bufferLogs: true });
  app.enableShutdownHooks();
  const config = app.get(AppConfigService);
  app.enableCors();
  await app.listen(config.getNumber('app.port'));
}
void bootstrap();
