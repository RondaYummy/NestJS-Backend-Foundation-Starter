import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { QUEUES } from '@infrastructure/bullmq/queues';
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';
import { RequestContextMiddleware } from '@infrastructure/logger/request-context.middleware';
import { IdempotencyInterceptor } from '@infrastructure/idempotency/idempotency.interceptor';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { ExceptionsModule } from '@infrastructure/exceptions/exceptions.module';
import { IdempotencyModule } from '@infrastructure/idempotency/idempotency.module';
import { HealthModule } from '@infrastructure/health/health.module';
import { RateLimiterModule } from '@infrastructure/rate-limiter/rate-limiter.module';
import { RateLimiterGuard } from '@infrastructure/rate-limiter/rate-limiter.guard';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import {
  mapAppConfigToBullMqOptions,
  mapAppConfigToDrizzleOptions,
  mapAppConfigToHealthOptions,
  mapAppConfigToRedisOptions,
} from '@infrastructure/config/create-starter-kit-module-options';
import { DrizzleModule } from '@infrastructure/database/drizzle/drizzle.module';
import { RedisModule } from '@infrastructure/redis/redis.module';

import { AuthController } from './controllers/auth.controller';
import { AuthApplicationCompositionModule } from './composition/auth-application.module';

const redisModule = RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToRedisOptions(config),
});

const drizzleModule = DrizzleModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToDrizzleOptions(config),
});

const bullMqConnectionModule = InfrastructureBullMqModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToBullMqOptions(config),
});

const bullMqQueuesModule = InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX], {
  imports: [bullMqConnectionModule],
});

const healthModule = HealthModule.registerAsync({
  imports: [InfrastructureConfigModule, redisModule, drizzleModule, bullMqQueuesModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToHealthOptions(config),
});

@Module({
  imports: [
    LoggerModule,
    ExceptionsModule,
    InfrastructureConfigModule,
    redisModule,
    drizzleModule,
    bullMqConnectionModule,
    bullMqQueuesModule,
    IdempotencyModule.register({ imports: [redisModule] }),
    healthModule,
    AuthApplicationCompositionModule.register({ redisModule, drizzleModule }),
    RateLimiterModule.register({ imports: [redisModule, InfrastructureConfigModule] }),
  ],
  controllers: [AuthController],
  providers: [
    RateLimiterGuard,
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
