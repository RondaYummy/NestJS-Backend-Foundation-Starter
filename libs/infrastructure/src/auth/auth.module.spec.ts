/// <reference types="jest" />

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { TOKENS } from '@contracts/tokens';
import type { IJwtTokenStore } from '@contracts/auth/jwt-token-store.service';
import { RedisService } from '../redis/redis.service';
import { AuthModule } from './auth.module';
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

const jwtOptions = {
  driver: 'jwt' as const,
  passwordSaltRounds: 10,
  jwt: {
    secret: 'secret',
    expiresIn: '15m',
    refreshSecret: 'refresh-secret',
    refreshExpiresIn: '7d',
  },
};

const sessionOptions = {
  driver: 'session' as const,
  passwordSaltRounds: 10,
  sessionTtlSeconds: 3600,
  resolveSessionUser: () => Promise.resolve(null),
};

describe('AuthModule', () => {
  it('registers JWT branch providers only for jwt driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule.forRoot(jwtOptions, { imports: [MockRedisModule] })],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(JwtAuthTokenService);
    expect(() => moduleRef.get(SessionAuthTokenService)).toThrow();

    await moduleRef.close();
  });

  it('registers session branch providers only for session driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule.forRoot(sessionOptions, { imports: [MockRedisModule] })],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(SessionAuthTokenService);
    expect(() => moduleRef.get(JwtAuthTokenService)).toThrow();

    await moduleRef.close();
  });

  it('forRoot fails fast without imports when default Redis stores are used (jwt)', () => {
    expect(() => AuthModule.forRoot(jwtOptions)).toThrow(
      /AuthModule\.forRoot\(\) requires RedisModule in registration\.imports/,
    );
  });

  it('forRoot fails fast without imports when default Redis stores are used (session)', () => {
    expect(() => AuthModule.forRoot(sessionOptions)).toThrow(
      /AuthModule\.forRoot\(\) requires RedisModule in registration\.imports/,
    );
  });

  it('forRoot compiles without Redis imports when a custom JwtTokenStore is provided', async () => {
    const jwtTokenStore: IJwtTokenStore = {
      saveRefreshToken: jest.fn(),
      rotateRefreshToken: jest.fn(),
      revokeRefreshTokenFamily: jest.fn(),
      revokeAccessToken: jest.fn(),
      isAccessTokenRevoked: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        AuthModule.forRoot(jwtOptions, {
          providers: [{ provide: TOKENS.JwtTokenStore, useValue: jwtTokenStore }],
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(JwtAuthTokenService);
    expect(moduleRef.get(TOKENS.JwtTokenStore)).toBe(jwtTokenStore);

    await moduleRef.close();
  });

  it('forRootAsync constructs only the selected auth token service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AuthModule.forRootAsync({
          imports: [MockRedisModule],
          useFactory: () => jwtOptions,
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.AuthTokenService)).toBeInstanceOf(JwtAuthTokenService);
    expect(() => moduleRef.get(SessionAuthTokenService)).toThrow();
    expect(moduleRef.get(JwtService)).toBeDefined();

    await moduleRef.close();
  });

  it('forRootAsync fails fast without imports when default Redis stores are used', () => {
    expect(() =>
      AuthModule.forRootAsync({
        useFactory: () => jwtOptions,
      }),
    ).toThrow(/AuthModule\.forRootAsync\(\) requires RedisModule in imports/);
  });
});
