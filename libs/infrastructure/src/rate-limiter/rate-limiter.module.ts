import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisRateLimiter } from './redis-rate-limiter';
import { RateLimiterGuard } from './rate-limiter.guard';

type RateLimiterModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class RateLimiterModule {
  static register(options: RateLimiterModuleRegisterOptions = {}): DynamicModule {
    return {
      module: RateLimiterModule,
      imports: options.imports ?? [],
      providers: [
        RedisRateLimiter,
        RateLimiterGuard,
        {
          provide: TOKENS.RateLimiter,
          useExisting: RedisRateLimiter,
        },
      ],
      exports: [TOKENS.RateLimiter, RateLimiterGuard],
    };
  }
}
