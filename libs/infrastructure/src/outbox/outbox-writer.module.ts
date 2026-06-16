import { Module } from '@nestjs/common';

import { TOKENS } from '@contracts/tokens';

import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { DrizzleOutboxWriter } from './drizzle-outbox-writer';

@Module({
  imports: [DrizzleModule],
  providers: [
    DrizzleOutboxWriter,
    {
      provide: TOKENS.OutboxWriter,
      useExisting: DrizzleOutboxWriter,
    },
  ],
  exports: [TOKENS.OutboxWriter],
})
export class OutboxWriterModule {}
