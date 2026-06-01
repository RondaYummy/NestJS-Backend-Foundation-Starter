import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export type RateLimitOptions = {
  /** Redis key prefix, e.g. `auth:login` → `auth:login:127.0.0.1` */
  keyPrefix: string;
  limit?: number;
  ttlSeconds?: number;
};

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
