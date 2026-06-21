import { runMigrations } from './run-migrations';

void runMigrations().catch((error: unknown) => {
  console.error('Database migration failed', error);

  process.exitCode = 1;
});
