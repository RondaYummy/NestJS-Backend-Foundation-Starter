import { Module } from '@nestjs/common';
import { EmailProcessor } from './processors/email.processor';
import { OutboxProcessor } from './processors/outbox.processor';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { MailModule } from '@infrastructure/mail/mail.module';
import { OutboxProcessorModule } from '@infrastructure/outbox/outbox-processor.module';
import { IdempotencyModule } from '@infrastructure/idempotency/idempotency.module';
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';

@Module({
  imports: [
    LoggerModule,
    InfrastructureBullMqModule,
    MailModule,
    IdempotencyModule,
    OutboxProcessorModule,
  ],
  providers: [EmailProcessor, OutboxProcessor],
})
export class WorkerModule {}
