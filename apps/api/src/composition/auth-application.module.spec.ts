/// <reference types="jest" />

import { Module, type DynamicModule } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { ChangePasswordUseCase } from '@application/use-cases/auth/change-password.usecase';
import { CompleteGoogleSignInUseCase } from '@application/use-cases/auth/complete-google-sign-in.usecase';
import { ForgotPasswordUseCase } from '@application/use-cases/auth/forgot-password.usecase';
import { ResetPasswordUseCase } from '@application/use-cases/auth/reset-password.usecase';
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

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
  })),
}));

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

@Module({})
class FakeQueuesModule {}

function createFakeQueuesModule(): DynamicModule {
  return {
    module: FakeQueuesModule,
    providers: [
      {
        provide: TOKENS.QueueGateway,
        useValue: { add: jest.fn().mockResolvedValue('job-1'), addBulk: jest.fn() },
      },
    ],
    exports: [TOKENS.QueueGateway],
  };
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
        queuesModule: createFakeQueuesModule(),
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
      expect(moduleRef.get(TOKENS.PasswordResetTokenStore)).toBeDefined();
      expect(moduleRef.get(ChangePasswordUseCase)).toBeDefined();
      expect(moduleRef.get(ForgotPasswordUseCase)).toBeDefined();
      expect(moduleRef.get(ResetPasswordUseCase)).toBeDefined();

      // TASK-004 / AC-01: with Google SSO disabled (default env — no Google
      // vars), the composition still boots and registers the Google ports.
      expect(moduleRef.get(CompleteGoogleSignInUseCase)).toBeDefined();
      expect(moduleRef.get(TOKENS.GoogleIdentityService)).toBeDefined();
      expect(moduleRef.get(TOKENS.GoogleOAuthStateStore)).toBeDefined();

      await moduleRef.close();
    });
  });
});
