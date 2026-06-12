import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ApplicationModule } from '@application/application.module';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { GlobalExceptionFilter } from '@infrastructure/exceptions/global-exception.filter';
import { requestContextMiddleware } from '@infrastructure/logger/request-context.middleware';
import { IdempotencyInterceptor } from '@infrastructure/idempotency/idempotency.interceptor';
import { AuthController } from './controllers/auth.controller';
import { OutboxModule } from '@infrastructure/outbox/outbox.module';

@Module({
  imports: [InfrastructureModule, ApplicationModule, OutboxModule],
  controllers: [AuthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
