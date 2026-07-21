/// <reference types="jest" />

import { Test } from '@nestjs/testing';

import { AppLogger } from './app-logger.service';
import { LoggerModule } from './logger.module';
import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

describe('LoggerModule', () => {
  it('boots with explicit forRoot options without InfrastructureConfigModule/AppConfigService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ level: 'info', pretty: false })],
    }).compile();

    expect(moduleRef.get(AppLogger)).toBeInstanceOf(AppLogger);
    expect(moduleRef.get(RequestContextService)).toBeInstanceOf(RequestContextService);
    expect(moduleRef.get(RequestContextMiddleware)).toBeInstanceOf(RequestContextMiddleware);

    await moduleRef.close();
  });

  it('boots with forRootAsync options without InfrastructureConfigModule/AppConfigService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          useFactory: () => ({ level: 'error', pretty: false }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(AppLogger)).toBeInstanceOf(AppLogger);
    expect(moduleRef.get(RequestContextService)).toBeInstanceOf(RequestContextService);
    expect(moduleRef.get(RequestContextMiddleware)).toBeInstanceOf(RequestContextMiddleware);

    await moduleRef.close();
  });
});
