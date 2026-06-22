import {
  ConfigurableModuleBuilder,
  DynamicModule,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';

import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { LoggerModule } from '../logger/logger.module';
import { AppLogger } from '../logger/app-logger.service';
import { RedisService } from './redis.service';
import { RedisKeyBuilder } from './redis-key-builder';
import { REDIS_CLIENT } from './redis.tokens';
import type { RedisModuleOptions } from './redis.module-options';

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<RedisModuleOptions>({
    optionsInjectionToken: 'REDIS_MODULE_OPTIONS',
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('forRootAsync')
    .build();

@Module({
  imports: [LoggerModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [MODULE_OPTIONS_TOKEN, AppLogger],
      useFactory: (options: RedisModuleOptions, logger: AppLogger) => {
        const client = new Redis({
          host: options.host,
          port: options.port,
          password: options.password || undefined,
          db: options.db,
          maxRetriesPerRequest: null,
          connectTimeout: options.connectTimeoutMs,
          retryStrategy: (attempt: number): number => Math.min(attempt * 250, 5000),
        });
        client.on('error', (error) => logger.error('Redis connection error', error));
        return client;
      },
    },
    {
      provide: RedisKeyBuilder,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: RedisModuleOptions) => new RedisKeyBuilder(options.keyPrefix),
    },
    RedisService,
    {
      provide: 'REDIS_SHUTDOWN',
      inject: [REDIS_CLIENT],
      useFactory: (client: Redis) => new RedisShutdown(client),
    },
  ],
  exports: [REDIS_CLIENT, RedisService, RedisKeyBuilder],
})
export class RedisModule extends ConfigurableModuleClass {
  static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
    return {
      ...super.forRoot(options),
      global: false,
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    return {
      ...super.forRootAsync(options),
      global: false,
    };
  }

  /**
   * @deprecated Use `forRootAsync` at the composition root with typed options instead.
   */
  static forRootFromAppConfig(): DynamicModule {
    return RedisModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.redis(),
    });
  }
}

export { MODULE_OPTIONS_TOKEN as REDIS_MODULE_OPTIONS_TOKEN };

class RedisShutdown implements OnApplicationShutdown {
  constructor(private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
