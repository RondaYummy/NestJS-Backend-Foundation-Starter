import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextMiddleware } from '@infrastructure/logger/request-context.middleware';
import { IdempotencyInterceptor } from '@infrastructure/idempotency/idempotency.interceptor';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { ExceptionsModule } from '@infrastructure/exceptions/exceptions.module';
import { IdempotencyModule } from '@infrastructure/idempotency/idempotency.module';
import { HealthModule } from '@infrastructure/health/health.module';
import { RateLimiterModule } from '@infrastructure/rate-limiter/rate-limiter.module';
import { RateLimiterGuard } from '@infrastructure/rate-limiter/rate-limiter.guard';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';

import { AuthController } from './controllers/auth.controller';
import { AuthApplicationCompositionModule } from './composition/auth-application.module';

@Module({
  imports: [
    LoggerModule,
    ExceptionsModule,
    IdempotencyModule,
    HealthModule,
    AuthApplicationCompositionModule,

    RateLimiterModule,
    InfrastructureConfigModule,
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
