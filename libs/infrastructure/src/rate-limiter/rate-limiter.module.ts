import {
  DynamicModule,
  Module,
  type FactoryProvider,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { RedisRateLimiter } from './redis-rate-limiter';
import { RateLimiterGuard } from './rate-limiter.guard';
import {
  RATE_LIMITER_MODULE_OPTIONS,
  type RateLimiterModuleOptions,
} from './rate-limiter.module-options';

type RateLimiterModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
  defaults: RateLimiterModuleOptions;
};

type RateLimiterModuleRegisterAsyncOptions = Pick<
  FactoryProvider<RateLimiterModuleOptions>,
  'inject' | 'useFactory'
> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class RateLimiterModule {
  static register(options: RateLimiterModuleRegisterOptions): DynamicModule {
    return RateLimiterModule.buildDynamicModule(options.imports ?? [], {
      provide: RATE_LIMITER_MODULE_OPTIONS,
      useValue: options.defaults,
    });
  }

  static registerAsync(options: RateLimiterModuleRegisterAsyncOptions): DynamicModule {
    return RateLimiterModule.buildDynamicModule(options.imports ?? [], {
      provide: RATE_LIMITER_MODULE_OPTIONS,
      inject: options.inject ?? [],
      useFactory: options.useFactory,
    });
  }

  private static buildDynamicModule(
    imports: ModuleMetadata['imports'],
    optionsProvider: Provider,
  ): DynamicModule {
    return {
      module: RateLimiterModule,
      imports,
      providers: [
        optionsProvider,
        RedisRateLimiter,
        RateLimiterGuard,
        {
          provide: TOKENS.RateLimiter,
          useExisting: RedisRateLimiter,
        },
      ],
      exports: [TOKENS.RateLimiter, RateLimiterGuard, RATE_LIMITER_MODULE_OPTIONS],
    };
  }
}
