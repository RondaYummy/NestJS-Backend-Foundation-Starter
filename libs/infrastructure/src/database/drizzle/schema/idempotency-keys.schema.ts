import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey(),
  key: varchar('key', { length: 255 }).notNull(),
  scope: varchar('scope', { length: 255 }).notNull(),
  requestHash: varchar('request_hash', { length: 255 }).notNull(),
  responsePayload: jsonb('response_payload'),
  status: varchar('status', { length: 50 }).notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
