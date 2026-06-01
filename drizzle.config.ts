import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './libs/infrastructure/src/database/drizzle/schema/*.ts',
  out: './libs/infrastructure/src/database/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/app',
  },
});
