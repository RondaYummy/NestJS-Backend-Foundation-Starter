import { Module } from '@nestjs/common';
import { ApplicationModule } from '@application/application.module';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { EmailProcessor } from './processors/email.processor';
import { OutboxProcessor } from './processors/outbox.processor';
import { DomainEventsProcessor } from './processors/user-registered.processor';

@Module({
  imports: [InfrastructureModule, ApplicationModule],
  providers: [EmailProcessor, OutboxProcessor, DomainEventsProcessor],
})
export class WorkerModule {}
