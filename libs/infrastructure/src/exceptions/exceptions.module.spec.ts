/// <reference types="jest" />

import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { AppLogger } from '../logger/app-logger.service';
import { LoggerModule } from '../logger/logger.module';
import { ExceptionsModule } from './exceptions.module';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('ExceptionsModule', () => {
  it('register with LoggerModule.forRoot resolves GlobalExceptionFilter and registers APP_FILTER', async () => {
    const loggerModule = LoggerModule.forRoot({ level: 'error', pretty: false });
    const dynamicModule = ExceptionsModule.register({ imports: [loggerModule] });

    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        GlobalExceptionFilter,
        expect.objectContaining({
          provide: APP_FILTER,
          useExisting: GlobalExceptionFilter,
        }),
      ]),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [loggerModule, dynamicModule],
    }).compile();

    expect(moduleRef.get(AppLogger)).toBeInstanceOf(AppLogger);
    expect(moduleRef.get(GlobalExceptionFilter)).toBeInstanceOf(GlobalExceptionFilter);

    await moduleRef.close();
  });

  it('register without a LoggerModule peer fails DI for AppLogger', async () => {
    await expect(
      Test.createTestingModule({
        imports: [ExceptionsModule.register({ imports: [] })],
      }).compile(),
    ).rejects.toThrow(/AppLogger|Nest can't resolve dependencies/i);
  });
});
