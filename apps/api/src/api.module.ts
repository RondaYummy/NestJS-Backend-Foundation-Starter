import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';

import { RequestContextMiddleware } from '@infrastructure/logger/request-context.middleware';

import { AuthController } from './controllers/auth.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from '@infrastructure/idempotency/idempotency.interceptor';
import { AuthApplicationCompositionModule } from './composition/auth-application.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { ExceptionsModule } from '@infrastructure/exceptions/exceptions.module';
import { IdempotencyModule } from '@infrastructure/idempotency/idempotency.module';
import { HealthModule } from '@infrastructure/health/health.module';
import { RateLimiterModule } from '@infrastructure/rate-limiter/rate-limiter.module';

@Module({
  imports: [
    LoggerModule,
    ExceptionsModule,
    IdempotencyModule,
    HealthModule,
    AuthApplicationCompositionModule,
    RateLimiterModule,
  ],
  controllers: [AuthController],
  providers: [
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
