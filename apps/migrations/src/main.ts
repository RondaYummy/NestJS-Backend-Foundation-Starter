import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
  }

  const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? './drizzle';

  const pool = new Pool({
    connectionString: databaseUrl,

    // Для одноразового migration process достатньо одного connection.
    max: 1,

    // Щоб process не зависав нескінченно при недоступній БД.
    connectionTimeoutMillis: 10_000,
  });

  try {
    const db = drizzle(pool);

    console.info('Starting database migrations', {
      migrationsFolder,
    });

    await migrate(db, {
      migrationsFolder,
    });

    console.info('Database migrations applied successfully');
  } finally {
    await pool.end();
  }
}

void runMigrations().catch((error: unknown) => {
  console.error('Database migration failed', error);

  process.exitCode = 1;
});
