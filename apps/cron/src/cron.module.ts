import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { OutboxSchedule } from './schedules/outbox.schedule';

@Module({
  imports: [ScheduleModule.forRoot(), InfrastructureModule],
  providers: [OutboxSchedule],
})
export class CronModule {}
