export type RateLimiterModuleOptions = {
  max: number;
  ttl: number;
  authMax: number;
  authTtl: number;
};

export const RATE_LIMITER_MODULE_OPTIONS = Symbol('RATE_LIMITER_MODULE_OPTIONS');
