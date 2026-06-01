import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogInput, IAuditLogger } from '@contracts/audit/audit-logger';
import { DRIZZLE_DB } from '../database/drizzle/drizzle.tokens';
import { auditLogs } from '../database/drizzle/schema/audit-logs.schema';

@Injectable()
export class AuditLogger implements IAuditLogger {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: {
      insert: (table: unknown) => { values: (value: unknown) => Promise<unknown> };
    },
  ) {}
  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({ id: randomUUID(), ...input });
    } catch {
      return;
    }
  }
}
