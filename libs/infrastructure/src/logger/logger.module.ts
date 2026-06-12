import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppLogger } from './app-logger.service';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [AppLogger, RequestContextService, RequestContextMiddleware],
  exports: [AppLogger, RequestContextService, RequestContextMiddleware],
})
export class LoggerModule {}
