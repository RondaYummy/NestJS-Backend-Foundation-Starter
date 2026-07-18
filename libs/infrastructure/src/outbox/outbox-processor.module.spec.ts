/// <reference types="jest" />

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';

import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { OUTBOX_PROCESSOR_DEFAULT_OPTIONS } from './outbox-processor.defaults';
import { OutboxProcessorModule } from './outbox-processor.module';

@Module({
  providers: [
    {
      provide: DRIZZLE_DB,
      useValue: {
        transaction: jest.fn(),
        update: jest.fn(),
        insert: jest.fn(),
      },
    },
    {
      provide: TOKENS.QueueGateway,
      useValue: {
        add: jest.fn(),
      },
    },
  ],
  exports: [DRIZZLE_DB, TOKENS.QueueGateway],
})
class MockConnectionModule {}

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_HOST: '127.0.0.1',
  JWT_SECRET: 'test-jwt-secret-for-unit-tests-only-ok',
  JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-for-unit-tests',
  AUTH_DRIVER: 'jwt',
};

function withTestEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(TEST_ENV)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return run().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

describe('OutboxProcessorModule', () => {
  it('forRootAsync compiles without UnknownExportException and exposes both tokens (P1-08)', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          OutboxProcessorModule.forRootAsync({
            imports: [MockConnectionModule],
            useFactory: () => OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
          }),
        ],
      }).compile();

      expect(moduleRef.get(TOKENS.OutboxProcessor)).toBeDefined();
      expect(moduleRef.get(TOKENS.OutboxProcessorOptions)).toBeDefined();

      await moduleRef.close();
    });
  });

  it('forRootAsync options resolved at importer scope match the factory output', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          OutboxProcessorModule.forRootAsync({
            imports: [MockConnectionModule],
            useFactory: () => OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
          }),
        ],
      }).compile();

      const options = moduleRef.get(TOKENS.OutboxProcessorOptions);

      expect(options.pollIntervalMs).toBe(OUTBOX_PROCESSOR_DEFAULT_OPTIONS.pollIntervalMs);
      expect(options.batchSize).toBe(OUTBOX_PROCESSOR_DEFAULT_OPTIONS.batchSize);

      await moduleRef.close();
    });
  });
});
