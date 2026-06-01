import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApplicationModule } from '@application/application.module';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { OutboxSchedule } from './schedules/outbox.schedule';
@Module({
  imports: [ScheduleModule.forRoot(), InfrastructureModule, ApplicationModule],
  providers: [OutboxSchedule],
})
export class CronModule {}
