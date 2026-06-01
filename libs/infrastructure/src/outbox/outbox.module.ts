import { Module } from '@nestjs/common';
import { DrizzleModule } from '../database/drizzle/drizzle.module';
import { OutboxService } from './outbox.service';
import { AuditModule } from '@infrastructure/audit/audit.module';

@Module({ imports: [DrizzleModule, AuditModule], providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
