import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { IRateLimiter } from '@contracts/rate-limiter/rate-limiter';
import { TOKENS } from '@contracts/tokens';
import { AppConfigService } from '../config/app-config.service';
@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    @Inject(TOKENS.RateLimiter) private readonly limiter: IRateLimiter,
    private readonly config: AppConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const result = await this.limiter.check({
      key: `rate:${req.ip}`,
      limit: this.config.getNumber('rateLimit.max'),
      ttlSeconds: this.config.getNumber('rateLimit.ttl'),
    });
    if (!result.allowed) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS, {
      cause: result.remaining,
    });
    return true;
  }
}
