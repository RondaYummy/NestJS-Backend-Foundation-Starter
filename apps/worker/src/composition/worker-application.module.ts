import { Module } from '@nestjs/common';

import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';

@Module({
  imports: [InfrastructureBullMqModule],
  providers: [],
  exports: [],
})
export class WorkerApplicationCompositionModule {}
