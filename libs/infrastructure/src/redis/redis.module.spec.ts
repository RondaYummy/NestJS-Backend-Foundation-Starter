/// <reference types="jest" />

import { Test } from '@nestjs/testing';

import { LoggerModule } from '../logger/logger.module';
import { AppLogger } from '../logger/app-logger.service';
import { REDIS_CLIENT } from './redis.tokens';
import { RedisModule } from './redis.module';

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
);

describe('RedisModule', () => {
  it('boots with typed options without InfrastructureConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule,
        RedisModule.forRoot({
          host: '127.0.0.1',
          port: 6379,
          db: 0,
          connectTimeoutMs: 1000,
        }),
      ],
    })
      .overrideProvider(AppLogger)
      .useValue({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() })
      .compile();

    const client = moduleRef.get(REDIS_CLIENT);
    expect(client).toBeDefined();
    expect(typeof client.quit).toBe('function');

    await moduleRef.close();
  });
});
