/// <reference types="jest" />

import { HttpException, HttpStatus, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { IRateLimiter } from '@contracts/rate-limiter/rate-limiter';

import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';
import { RateLimiterGuard } from './rate-limiter.guard';
import type { RateLimiterModuleOptions } from './rate-limiter.module-options';

const DEFAULT_OPTIONS: RateLimiterModuleOptions = {
  max: 100,
  ttl: 60,
  authMax: 5,
  authTtl: 120,
};

type CheckInput = { key: string; limit: number; ttlSeconds: number };

function createLimiter(allowed: boolean): {
  limiter: IRateLimiter;
  calls: CheckInput[];
} {
  const calls: CheckInput[] = [];
  const limiter: IRateLimiter = {
    check: jest.fn((input: CheckInput) => {
      calls.push(input);
      return Promise.resolve({
        allowed,
        remaining: allowed ? input.limit - 1 : 0,
        resetAt: new Date(Date.now() + input.ttlSeconds * 1000),
      });
    }),
  };
  return { limiter, calls };
}

function createContext(decoratorOptions?: RateLimitOptions): {
  context: ExecutionContext;
  res: { setHeader: jest.Mock };
} {
  const req = { ip: '127.0.0.1' };
  const res = { setHeader: jest.fn() };

  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  jest
    .spyOn(Reflector.prototype, 'getAllAndOverride')
    .mockImplementation((key: unknown) =>
      key === RATE_LIMIT_KEY ? decoratorOptions : undefined,
    );

  return { context, res };
}

describe('RateLimiterGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses module default max/ttl for non-auth endpoints without decorator overrides', async () => {
    const { limiter, calls } = createLimiter(true);
    const guard = new RateLimiterGuard(limiter, DEFAULT_OPTIONS, new Reflector());
    const { context } = createContext(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(calls[0]).toEqual({
      key: 'rate:127.0.0.1',
      limit: DEFAULT_OPTIONS.max,
      ttlSeconds: DEFAULT_OPTIONS.ttl,
    });
  });

  it('uses auth defaults for auth:-prefixed endpoints', async () => {
    const { limiter, calls } = createLimiter(true);
    const guard = new RateLimiterGuard(limiter, DEFAULT_OPTIONS, new Reflector());
    const { context } = createContext({ keyPrefix: 'auth:login' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(calls[0]).toEqual({
      key: 'auth:login:127.0.0.1',
      limit: DEFAULT_OPTIONS.authMax,
      ttlSeconds: DEFAULT_OPTIONS.authTtl,
    });
  });

  it('prefers decorator overrides over module defaults', async () => {
    const { limiter, calls } = createLimiter(true);
    const guard = new RateLimiterGuard(limiter, DEFAULT_OPTIONS, new Reflector());
    const { context } = createContext({ keyPrefix: 'auth:login', limit: 3, ttlSeconds: 15 });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(calls[0]).toEqual({
      key: 'auth:login:127.0.0.1',
      limit: 3,
      ttlSeconds: 15,
    });
  });

  it('throws 429 with Retry-After when the limit is exceeded', async () => {
    const { limiter } = createLimiter(false);
    const guard = new RateLimiterGuard(limiter, DEFAULT_OPTIONS, new Reflector());
    const { context, res } = createContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);

    try {
      await guard.canActivate(context);
    } catch (error) {
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });
});
