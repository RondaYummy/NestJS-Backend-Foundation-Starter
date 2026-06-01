import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { AuditLogger } from './audit.logger';
@Module({
  imports: [DrizzleModule],
  providers: [AuditLogger, { provide: TOKENS.AuditLogger, useExisting: AuditLogger }],
  exports: [TOKENS.AuditLogger],
})
export class AuditModule {}
