/// <reference types="jest" />

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';

import { RedisService } from '../redis/redis.service';
import { RateLimiterGuard } from './rate-limiter.guard';
import { RateLimiterModule } from './rate-limiter.module';
import {
  RATE_LIMITER_MODULE_OPTIONS,
  type RateLimiterModuleOptions,
} from './rate-limiter.module-options';
import { RedisRateLimiter } from './redis-rate-limiter';

const fakeRedisService = {
  incrementWithTtl: jest.fn().mockResolvedValue({ count: 1, ttl: 60 }),
} as unknown as RedisService;

@Module({
  providers: [{ provide: RedisService, useValue: fakeRedisService }],
  exports: [RedisService],
})
class FakeRedisModule {}

const DEFAULTS: RateLimiterModuleOptions = {
  max: 100,
  ttl: 60,
  authMax: 5,
  authTtl: 120,
};

describe('RateLimiterModule', () => {
  it('register provides the guard, limiter and options token without config coupling', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RateLimiterModule.register({
          imports: [FakeRedisModule],
          defaults: DEFAULTS,
        }),
      ],
    }).compile();

    expect(moduleRef.get(RateLimiterGuard)).toBeInstanceOf(RateLimiterGuard);
    expect(moduleRef.get(TOKENS.RateLimiter)).toBeInstanceOf(RedisRateLimiter);
    expect(moduleRef.get(RATE_LIMITER_MODULE_OPTIONS)).toEqual(DEFAULTS);

    await moduleRef.close();
  });

  it('registerAsync resolves options via a factory', async () => {
    const factory = jest.fn(() => DEFAULTS);

    const moduleRef = await Test.createTestingModule({
      imports: [
        RateLimiterModule.registerAsync({
          imports: [FakeRedisModule],
          inject: [],
          useFactory: factory,
        }),
      ],
    }).compile();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(moduleRef.get(RATE_LIMITER_MODULE_OPTIONS)).toEqual(DEFAULTS);
    expect(moduleRef.get(RateLimiterGuard)).toBeInstanceOf(RateLimiterGuard);

    await moduleRef.close();
  });
});
