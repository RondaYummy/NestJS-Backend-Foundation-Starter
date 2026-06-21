/**
 * Stable PostgreSQL advisory lock keys for the NestJS starter kit migration runner.
 *
 * Uses two-int `pg_advisory_lock(key1, key2)` to avoid collisions with unrelated
 * advisory-lock users in the same database.
 */
export const MIGRATION_ADVISORY_LOCK_KEYS = [20260621, 1] as const;
