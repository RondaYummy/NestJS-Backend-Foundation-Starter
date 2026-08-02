import Redis from 'ioredis';
import { Pool } from 'pg';

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/app';

export type AssertPostgresAvailableOptions = {
  databaseUrl?: string;
  /** SQL used to verify reachability; default `SELECT 1`. Outbox may probe a required table. */
  probeSql?: string;
};

function formatProbeError(error: unknown): string {
  if (error instanceof AggregateError && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors
      .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
      .join('; ');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Fail-closed probe for `npm run test:int`.
 * Throws when PostgreSQL is unreachable so suites cannot soft-pass without live infra.
 */
export async function assertPostgresAvailable(
  options: AssertPostgresAvailableOptions = {},
): Promise<void> {
  const databaseUrl = options.databaseUrl ?? DEFAULT_DATABASE_URL;
  const probeSql = options.probeSql ?? 'SELECT 1';

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });

  let probeError: unknown;

  try {
    await pool.query(probeSql);
    await pool.end();
    return;
  } catch (error) {
    probeError = error;
    try {
      await pool.end();
    } catch {
      // ignore cleanup errors when PostgreSQL is unavailable
    }
  }

  throw new Error(
    `npm run test:int requires PostgreSQL at ${databaseUrl} (fail-closed; must not soft-pass). Probe failed: ${formatProbeError(probeError)}`,
  );
}

export type AssertRedisAvailableOptions = {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
};

/**
 * Fail-closed probe for `npm run test:int`.
 * Throws when Redis is unreachable so suites cannot soft-pass without live infra.
 */
export async function assertRedisAvailable(
  options: AssertRedisAvailableOptions = {},
): Promise<void> {
  const host = options.host ?? process.env.REDIS_HOST ?? 'localhost';
  const port = options.port ?? Number(process.env.REDIS_PORT ?? 6379);
  const password =
    options.password ?? (process.env.REDIS_PASSWORD ? process.env.REDIS_PASSWORD : undefined);
  const db = options.db ?? Number(process.env.REDIS_DB ?? 0);
  const target = `${host}:${port}`;

  const client = new Redis({
    host,
    port,
    password,
    db,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  let probeError: unknown;

  try {
    await client.connect();
    await client.ping();
    await client.quit();
    return;
  } catch (error) {
    probeError = error;
    try {
      client.disconnect();
    } catch {
      // ignore cleanup errors when Redis is unavailable
    }
  }

  throw new Error(
    `npm run test:int requires Redis at ${target} (fail-closed; must not soft-pass). Probe failed: ${formatProbeError(probeError)}`,
  );
}
