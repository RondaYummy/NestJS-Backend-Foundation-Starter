import { Module } from '@nestjs/common';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { EmailProcessor } from './processors/email.processor';
import { OutboxProcessor } from './processors/outbox.processor';
import { UserRegisteredProcessor } from './processors/user-registered.processor';
import { WorkerApplicationCompositionModule } from './composition/worker-application.module';

@Module({
  imports: [InfrastructureModule, WorkerApplicationCompositionModule],
  providers: [EmailProcessor, OutboxProcessor, UserRegisteredProcessor],
})
export class WorkerModule {}
