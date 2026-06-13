import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import type { IRateLimiter } from '@contracts/rate-limiter/rate-limiter';
import { TOKENS } from '@contracts/tokens';

import { AppConfigService } from '../config/app-config.service';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    @Inject(TOKENS.RateLimiter)
    private readonly limiter: IRateLimiter,

    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const keyPrefix = options?.keyPrefix ?? 'rate';

    const isAuthEndpoint = keyPrefix.startsWith('auth:');

    const limit =
      options?.limit ??
      (isAuthEndpoint ? this.config.rateLimit().authMax : this.config.rateLimit().max);

    const ttlSeconds =
      options?.ttlSeconds ??
      (isAuthEndpoint ? this.config.rateLimit().authTtl : this.config.rateLimit().ttl);

    const result = await this.limiter.check({
      key: `${keyPrefix}:${req.ip}`,
      limit,
      ttlSeconds,
    });

    const resetTimestamp = Math.ceil(result.resetAt.getTime() / 1000);

    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', result.remaining);
    res.setHeader('RateLimit-Reset', resetTimestamp);

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
        1,
      );

      res.setHeader('Retry-After', retryAfterSeconds);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Too many requests',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
