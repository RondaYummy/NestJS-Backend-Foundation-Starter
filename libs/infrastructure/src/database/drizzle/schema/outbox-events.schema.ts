import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    eventName: varchar('event_name', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', {
      withTimezone: true,
    }),
    occurredAt: timestamp('occurred_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lockedBy: varchar('locked_by', {
      length: 255,
    }),
    processedAt: timestamp('processed_at', {
      withTimezone: true,
    }),
    error: text('error'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pendingLookupIndex: index('outbox_events_pending_lookup_idx')
      .on(table.availableAt, table.attempts, table.createdAt)
      .where(sql`${table.status} = 'pending'`),

    processingLockIndex: index('outbox_events_processing_lock_idx')
      .on(table.lockedAt)
      .where(sql`${table.status} = 'processing'`),
  }),
);
