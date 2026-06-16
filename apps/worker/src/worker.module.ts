import { Module } from '@nestjs/common';
import { EmailProcessor } from './processors/email.processor';
import { OutboxProcessor } from './processors/outbox.processor';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { MailModule } from '@infrastructure/mail/mail.module';
import { OutboxModule } from '@infrastructure/outbox/outbox.module';
import { IdempotencyModule } from '@infrastructure/idempotency/idempotency.module';
import { InfrastructureBullMqModule } from '@infrastructure/bullmq/bullmq.module';

@Module({
  imports: [LoggerModule, InfrastructureBullMqModule, MailModule, IdempotencyModule, OutboxModule],
  providers: [EmailProcessor, OutboxProcessor],
})
export class WorkerModule {}
