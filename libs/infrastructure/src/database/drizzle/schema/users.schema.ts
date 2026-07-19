import { pgTable, uuid, varchar, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // Nullable: Google-only accounts (TASK-004) never store a local password.
  passwordHash: varchar('password_hash', { length: 255 }),
  // Durable Google OIDC subject; unique allows multiple NULLs in PostgreSQL.
  googleSub: varchar('google_sub', { length: 255 }).unique(),
  roles: jsonb('roles').$type<string[]>().notNull().default(['user']),
  authVersion: integer('auth_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
