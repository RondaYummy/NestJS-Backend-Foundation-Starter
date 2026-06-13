import { Module } from '@nestjs/common';

import { HandleUserRegisteredUseCase } from
  '@application/use-cases/users/emails/handle-user-registered.usecase';

import { InfrastructureBullMqModule } from
  '@infrastructure/bullmq/bullmq.module';

@Module({
  imports: [InfrastructureBullMqModule],
  providers: [HandleUserRegisteredUseCase],
  exports: [HandleUserRegisteredUseCase],
})
export class WorkerApplicationCompositionModule {}