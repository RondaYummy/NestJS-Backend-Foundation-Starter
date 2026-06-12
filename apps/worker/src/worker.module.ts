import { Module } from '@nestjs/common';
import { ApplicationModule } from '@application/application.module';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { EmailProcessor } from './processors/email.processor';
import { OutboxProcessor } from './processors/outbox.processor';
import { OutboxModule } from '@infrastructure/outbox/outbox.module';

@Module({
  imports: [InfrastructureModule, ApplicationModule, OutboxModule],
  providers: [EmailProcessor, OutboxProcessor],
})
export class WorkerModule {}
