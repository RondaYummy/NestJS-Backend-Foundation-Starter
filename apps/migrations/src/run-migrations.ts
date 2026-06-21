import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { acquireMigrationAdvisoryLock, releaseMigrationAdvisoryLock } from './migration-lock';

const DEFAULT_LOCK_TIMEOUT_MS = 60_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30 * 60 * 1_000;

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
  }

  const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? './drizzle';

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  const client = await pool.connect();

  try {
    await client.query(`SET statement_timeout = '${DEFAULT_STATEMENT_TIMEOUT_MS}ms'`);

    await acquireMigrationAdvisoryLock(client, {
      lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
    });

    const db = drizzle(client);

    console.info('Starting database migrations', {
      migrationsFolder,
    });

    await migrate(db, {
      migrationsFolder,
    });

    console.info('Database migrations applied successfully');
  } finally {
    await releaseMigrationAdvisoryLock(client);
    client.release();
    await pool.end();
  }
}
