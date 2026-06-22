/// <reference types="jest" />

import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';

import { DrizzleModule } from '@infrastructure/database/drizzle/drizzle.module';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { RedisModule } from '@infrastructure/redis/redis.module';

import { AuthApplicationCompositionModule } from './auth-application.module';

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
);

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
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

describe('AuthApplicationCompositionModule', () => {
  it('resolves Auth/JWT providers including TOKENS.UserRepository', async () => {
    await withTestEnv(async () => {
      const redisModule = RedisModule.forRoot({
        host: '127.0.0.1',
        port: 6379,
        db: 0,
        connectTimeoutMs: 1000,
      });
      const drizzleModule = DrizzleModule.forRoot({
        connectionString: 'postgresql://localhost:5432/test',
      });
      const compositionModule = AuthApplicationCompositionModule.register({
        redisModule,
        drizzleModule,
      });

      const moduleRef = await Test.createTestingModule({
        imports: [compositionModule],
      })
        .overrideProvider(AppLogger)
        .useValue({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() })
        .compile();

      expect(moduleRef.get(JwtService)).toBeDefined();
      expect(moduleRef.get(TOKENS.UserRepository)).toBeDefined();
      expect(moduleRef.get(TOKENS.AuthTokenService)).toBeDefined();

      await moduleRef.close();
    });
  });
});
