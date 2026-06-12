import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';

import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { RequestContextMiddleware } from '@infrastructure/logger/request-context.middleware';

import { AuthController } from './controllers/auth.controller';
import { OutboxModule } from '@infrastructure/outbox/outbox.module';
import { ApplicationModule } from '@application/application.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from '@infrastructure/idempotency/idempotency.interceptor';

@Module({
  imports: [InfrastructureModule, ApplicationModule, OutboxModule],
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
