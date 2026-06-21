import type { PoolClient } from 'pg';

import { MIGRATION_ADVISORY_LOCK_KEYS } from './migration-lock.constants';

export interface MigrationLockOptions {
  lockTimeoutMs: number;
}

export async function acquireMigrationAdvisoryLock(
  client: PoolClient,
  options: MigrationLockOptions,
): Promise<void> {
  const [key1, key2] = MIGRATION_ADVISORY_LOCK_KEYS;

  await client.query(`SET lock_timeout = '${options.lockTimeoutMs}ms'`);

  try {
    await client.query('SELECT pg_advisory_lock($1::int, $2::int)', [key1, key2]);
  } catch (error: unknown) {
    throw new Error(
      'Timed out waiting for migration advisory lock. Another migration process may be running.',
      { cause: error },
    );
  }
}

export async function releaseMigrationAdvisoryLock(client: PoolClient): Promise<void> {
  const [key1, key2] = MIGRATION_ADVISORY_LOCK_KEYS;

  try {
    await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [key1, key2]);
  } catch (error: unknown) {
    console.warn('Failed to release migration advisory lock', error);
  }
}
