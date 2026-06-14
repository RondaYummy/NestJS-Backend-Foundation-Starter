import { Module } from '@nestjs/common';

import { AuditModule } from '@infrastructure/audit/audit.module';

import { TOKENS } from '@contracts/tokens';

import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { OutboxService } from './outbox.service';
import { EventsModule } from '@infrastructure/events/events.module';

@Module({
  imports: [DrizzleModule, AuditModule, EventsModule],
  providers: [
    OutboxService,
    {
      provide: TOKENS.OutboxWriter,
      useExisting: OutboxService,
    },

    {
      provide: TOKENS.OutboxProcessor,
      useExisting: OutboxService,
    },
  ],
  exports: [OutboxService, TOKENS.OutboxWriter, TOKENS.OutboxProcessor],
})
export class OutboxModule {}
