import { Module } from '@nestjs/common';

import { TOKENS } from '@contracts/tokens';

import { AuditModule } from '../audit/audit.module';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { EventsModule } from '../events/events.module';
import { LoggerModule } from '../logger/logger.module';
import { DrizzleOutboxProcessor } from './drizzle-outbox-processor';

@Module({
  imports: [DrizzleModule, AuditModule, EventsModule, LoggerModule],
  providers: [
    DrizzleOutboxProcessor,
    {
      provide: TOKENS.OutboxProcessor,
      useExisting: DrizzleOutboxProcessor,
    },
  ],
  exports: [TOKENS.OutboxProcessor],
})
export class OutboxProcessorModule {}
