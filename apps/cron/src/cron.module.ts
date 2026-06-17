import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxSchedule } from './schedules/outbox.schedule';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { LocksModule } from '@infrastructure/locks/locks.module';
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';
import { OutboxProcessorModule } from '@infrastructure/outbox/outbox-processor.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    InfrastructureConfigModule,
    LoggerModule,
    InfrastructureBullMqModule,
    LocksModule,
    OutboxProcessorModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.outbox(),
    }),
  ],
  providers: [OutboxSchedule],
})
export class CronModule {}
