import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';

import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { RequestContextMiddleware } from '@infrastructure/logger/request-context.middleware';

import { AuthController } from './controllers/auth.controller';
import { OutboxModule } from '@infrastructure/outbox/outbox.module';
import { ApplicationModule } from '@application/application.module';

@Module({
  imports: [InfrastructureModule, ApplicationModule, LoggerModule, OutboxModule],
  controllers: [AuthController],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
