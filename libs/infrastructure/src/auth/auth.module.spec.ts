/// <reference types="jest" />

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { TOKENS } from '@contracts/tokens';
import { RedisService } from '../redis/redis.service';
import { AuthModule } from './auth.module';
import type { AuthModuleOptions } from './auth.module-options';
import { JwtAuthTokenService } from './jwt-auth-token.service';
import { SessionAuthTokenService } from './session-auth-token.service';

@Module({
  providers: [
    {
      provide: RedisService,
      useValue: {
        set: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        eval: jest.fn(),
        setIfNotExists: jest.fn(),
        compareAndExpire: jest.fn(),
        compareAndDelete: jest.fn(),
      },
    },
  ],
  exports: [RedisService],
})
class MockRedisModule {}

describe('AuthModule', () => {
  function withMockRedis(options: AuthModuleOptions) {
    const dynamicModule = AuthModule.forRoot(options);
    dynamicModule.imports = [MockRedisModule, ...(dynamicModule.imports ?? [])];
    return dynamicModule;
  }

  it('registers JWT branch providers only for jwt driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        withMockRedis({
          driver: 'jwt',
          passwordSaltRounds: 10,
          jwt: {
            secret: 'secret',
            expiresIn: '15m',
            refreshSecret: 'refresh-secret',
            refreshExpiresIn: '7d',
          },
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(JwtAuthTokenService);
    expect(() => moduleRef.get(SessionAuthTokenService)).toThrow();

    await moduleRef.close();
  });

  it('registers session branch providers only for session driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        withMockRedis({
          driver: 'session',
          passwordSaltRounds: 10,
          sessionTtlSeconds: 3600,
          resolveSessionUser: () => Promise.resolve(null),
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(SessionAuthTokenService);
    expect(() => moduleRef.get(JwtAuthTokenService)).toThrow();

    await moduleRef.close();
  });

  it('forRootAsync constructs only the selected auth token service', async () => {
    const dynamicModule = AuthModule.forRootAsync({
      useFactory: () => ({
        driver: 'jwt' as const,
        passwordSaltRounds: 10,
        jwt: {
          secret: 'secret',
          expiresIn: '15m',
          refreshSecret: 'refresh-secret',
          refreshExpiresIn: '7d',
        },
      }),
    });
    dynamicModule.imports = [MockRedisModule, ...(dynamicModule.imports ?? [])];

    const moduleRef = await Test.createTestingModule({
      imports: [dynamicModule],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(JwtAuthTokenService);
    expect(() => moduleRef.get(SessionAuthTokenService)).toThrow();
    expect(moduleRef.get(JwtService)).toBeDefined();

    await moduleRef.close();
  });
});
