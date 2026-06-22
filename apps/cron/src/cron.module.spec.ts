/// <reference types="jest" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';

import { DRIZZLE_DB } from '@infrastructure/database/drizzle/drizzle.tokens';
import { AppLogger } from '@infrastructure/logger/app-logger.service';

import { CronModule } from './cron.module';
import { OutboxSchedule } from './schedules/outbox.schedule';

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
);

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

describe('CronModule', () => {
  it('does not import DrizzleModule or OutboxProcessorModule in the composition root', () => {
    const source = readFileSync(join(__dirname, 'cron.module.ts'), 'utf8');

    expect(source).not.toMatch(/DrizzleModule/);
    expect(source).not.toMatch(/OutboxProcessorModule/);
    expect(source).toMatch(/OutboxProcessorOptionsModule/);
  });

  it('compiles without Drizzle and resolves OutboxSchedule dependencies', async () => {
    await withTestEnv(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [CronModule],
      })
        .overrideProvider(AppLogger)
        .useValue({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() })
        .compile();

      expect(moduleRef.get(OutboxSchedule)).toBeDefined();
      expect(moduleRef.get(TOKENS.OutboxProcessorOptions)).toBeDefined();
      expect(() => moduleRef.get(DRIZZLE_DB)).toThrow();

      await moduleRef.init();
      await moduleRef.close();
    });
  });
});
