import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { RedisModule } from '../redis/redis.module';
import { RedisRateLimiter } from './redis-rate-limiter';
import { RateLimiterGuard } from './rate-limiter.guard';
@Module({
  imports: [RedisModule, InfrastructureConfigModule],
  providers: [
    RedisRateLimiter,
    RateLimiterGuard,
    { provide: TOKENS.RateLimiter, useExisting: RedisRateLimiter },
  ],
  exports: [TOKENS.RateLimiter, RateLimiterGuard],
})
export class RateLimiterModule {}
