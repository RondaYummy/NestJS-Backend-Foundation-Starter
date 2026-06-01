import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  actorId: varchar('actor_id', { length: 255 }),
  actorType: varchar('actor_type', { length: 50 }).notNull(),
  action: varchar('action', { length: 255 }).notNull(),
  entityType: varchar('entity_type', { length: 255 }),
  entityId: varchar('entity_id', { length: 255 }),
  metadata: jsonb('metadata'),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
