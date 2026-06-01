import { Module } from '@nestjs/common';
import { LoggerModule } from '../logger/logger.module';
import { GlobalExceptionFilter } from './global-exception.filter';
@Module({
  imports: [LoggerModule],
  providers: [GlobalExceptionFilter],
  exports: [GlobalExceptionFilter],
})
export class ExceptionsModule {}
