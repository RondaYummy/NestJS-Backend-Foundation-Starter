/// <reference types="jest" />

import path from 'node:path';

import { Pool } from 'pg';

import { acquireMigrationAdvisoryLock, releaseMigrationAdvisoryLock } from './migration-lock';
import { runMigrations } from './run-migrations';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/app';

const MIGRATIONS_FOLDER = path.join(
  process.cwd(),
  'libs/infrastructure/src/database/drizzle/migrations',
);

async function isPostgresAvailable(): Promise<boolean> {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });

  try {
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch {
    try {
      await pool.end();
    } catch {
      // ignore cleanup errors when PostgreSQL is unavailable
    }

    return false;
  }
}

describe('runMigrations integration (V-06)', () => {
  let postgresAvailable: boolean;
  const originalMigrationsFolder = process.env.MIGRATIONS_FOLDER;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
  });

  beforeEach(() => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MIGRATIONS_FOLDER = MIGRATIONS_FOLDER;
  });

  afterEach(() => {
    if (originalMigrationsFolder === undefined) {
      delete process.env.MIGRATIONS_FOLDER;
    } else {
      process.env.MIGRATIONS_FOLDER = originalMigrationsFolder;
    }
  });

  it('serializes concurrent advisory lock acquisition', async () => {
    if (!postgresAvailable) {
      return;
    }

    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 2,
    });

    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      await acquireMigrationAdvisoryLock(client1, { lockTimeoutMs: 5_000 });

      const acquirePromise = acquireMigrationAdvisoryLock(client2, {
        lockTimeoutMs: 2_000,
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });

      await releaseMigrationAdvisoryLock(client1);

      await expect(acquirePromise).resolves.toBeUndefined();
    } finally {
      await releaseMigrationAdvisoryLock(client2);
      client1.release();
      client2.release();
      await pool.end();
    }
  });

  it('runs two parallel migration processes safely', async () => {
    if (!postgresAvailable) {
      return;
    }

    const results = await Promise.allSettled([runMigrations(), runMigrations()]);

    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }

    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1,
    });

    try {
      const { rows } = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM __drizzle_migrations',
      );

      expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it('releases advisory lock when migration fails', async () => {
    if (!postgresAvailable) {
      return;
    }

    process.env.MIGRATIONS_FOLDER = path.join(process.cwd(), 'nonexistent-migrations-folder');

    await expect(runMigrations()).rejects.toThrow();

    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1,
    });

    const client = await pool.connect();

    try {
      await expect(
        acquireMigrationAdvisoryLock(client, { lockTimeoutMs: 5_000 }),
      ).resolves.toBeUndefined();
    } finally {
      await releaseMigrationAdvisoryLock(client);
      client.release();
      await pool.end();
    }
  });
});
