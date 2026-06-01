import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { IRateLimiter } from '@contracts/rate-limiter/rate-limiter';
import { TOKENS } from '@contracts/tokens';
import { AppConfigService } from '../config/app-config.service';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    @Inject(TOKENS.RateLimiter) private readonly limiter: IRateLimiter,
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isAuthEndpoint = options?.keyPrefix.startsWith('auth:') ?? false;
    const limit =
      options?.limit ??
      (isAuthEndpoint
        ? this.config.getNumber('rateLimit.authMax')
        : this.config.getNumber('rateLimit.max'));
    const ttlSeconds =
      options?.ttlSeconds ??
      (isAuthEndpoint
        ? this.config.getNumber('rateLimit.authTtl')
        : this.config.getNumber('rateLimit.ttl'));
    const keyPrefix = options?.keyPrefix ?? 'rate';

    const result = await this.limiter.check({
      key: `${keyPrefix}:${req.ip}`,
      limit,
      ttlSeconds,
    });

    if (!result.allowed) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS, {
        cause: result.remaining,
      });
    }

    return true;
  }
}
