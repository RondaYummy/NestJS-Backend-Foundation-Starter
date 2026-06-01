import { pgTable, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),

  userId: uuid('user_id').notNull(),

  payload: jsonb('payload')
    .$type<{
      id: string;
      email: string;
      roles: string[];
    }>()
    .notNull(),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
