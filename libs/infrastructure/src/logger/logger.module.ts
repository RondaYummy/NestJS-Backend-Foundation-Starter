import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppLogger } from './app-logger.service';

@Module({ imports: [InfrastructureConfigModule], providers: [AppLogger], exports: [AppLogger] })
export class LoggerModule {}
