---
issue_id: P2-01
status: approved
owner: human-approval-required
---

# P2-01 — Serialize parallel PostgreSQL migrations

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-01. Серіалізувати паралельні PostgreSQL migrations**.

Related verification scenario: backlog **V-06** (Two parallel migration processes serialize safely).

**Investigation (2026-06-21, branch `main`):** likely defect confirmed. Issue is **not stale**. Production migrator in `apps/migrations/src/main.ts` still calls Drizzle `migrate()` without a PostgreSQL advisory lock.

## Current behavior

1. **Production migration entrypoint** — `apps/migrations/src/main.ts` :: `runMigrations()`:
   - Requires `DATABASE_URL`; uses `MIGRATIONS_FOLDER` (default `./drizzle`).
   - Creates `pg.Pool` with `max: 1` and `connectionTimeoutMillis: 10_000`.
   - Calls `drizzle(pool)` then `migrate(db, { migrationsFolder })` from `drizzle-orm/node-postgres/migrator`.
   - Closes the pool in `finally`; sets `process.exitCode = 1` on failure.
   - **No advisory lock**, no `lock_timeout`, no `statement_timeout`.
2. **Two migration execution paths exist:**

   | Path               | Command                                                     | Runner                                      | Migrations folder                                     |
   | ------------------ | ----------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
   | Dev / local Docker | `npm run db:migrate`                                        | `drizzle-kit migrate` (`drizzle.config.ts`) | `libs/infrastructure/src/database/drizzle/migrations` |
   | Production         | `npm run db:migrate:prod` → `npm run start:prod:migrations` | `node dist/apps/migrations/main.js`         | `./drizzle` or `MIGRATIONS_FOLDER=/app/drizzle`       |

3. **Deployment wiring:**
   - `Dockerfile` copies SQL to `./drizzle` from `libs/infrastructure/src/database/drizzle/migrations`.
   - `docker-compose.prod.yml` — `migrations` service runs `start:prod:migrations`, `restart: 'no'`; api/worker/cron depend on `service_completed_successfully`.
   - `docker-compose.yml` (dev) — migrations service runs `db:migrate` (drizzle-kit), not the compiled entrypoint.
4. **Runtime apps do not migrate:** API, Worker, and Cron entrypoints contain no `migrate()` calls.
5. **Drizzle behavior:** Drizzle maintains a migration journal table but does not serialize concurrent `migrate()` callers; community reports confirm race risk when two processes apply pending migrations simultaneously.

## Confirmed root cause

1. **Missing deployment-level mutex:** `apps/migrations/src/main.ts` invokes `migrate()` without `pg_advisory_lock` (or equivalent), so two production migration jobs (rolling deploy, duplicate CI, manual parallel `docker compose run`) can execute DDL concurrently.
2. **Session-level lock requirement not met:** PostgreSQL advisory locks are **per session**. Using `drizzle(pool)` without `pool.connect()` does not guarantee lock acquisition and migration run on the same session; a dedicated `Client` is required.
3. **Secondary unprotected path:** `npm run db:migrate` (drizzle-kit CLI) is a separate code path with no locking — relevant for dev/CI but outside the cited backlog evidence file (`apps/migrations/src/main.ts`).

## Dependency/runtime flow

```text
Production deploy
  └─ docker-compose.prod.yml / K8s Job / CI
       └─ npm run start:prod:migrations
            └─ apps/migrations/src/main.ts :: runMigrations()
                 ├─ new pg.Pool({ max: 1 })
                 ├─ drizzle(pool)
                 └─ migrate(db, { migrationsFolder })   ← no lock

Dev compose
  └─ migrations service
       └─ npm run db:migrate
            └─ drizzle-kit migrate (drizzle.config.ts)   ← no lock, different runner

Runtime apps (api/worker/cron)
  └─ depend on migrations job completing (compose only)
       └─ do NOT run migrations themselves
```

Orchestration (`depends_on`, `restart: 'no'`) reduces but does not eliminate parallel human/CI triggers.

## Goal

Ensure the production Migrations entrypoint serializes concurrent migration attempts against the same PostgreSQL database using a session-level advisory lock with bounded wait/statement timeouts, while preserving the standalone one-shot deployment job contract.

## Scope

1. Extract testable migration orchestration from `main.ts`.
2. Use a dedicated `pg.Client` session for lock + migrate + unlock on the same connection.
3. Acquire `pg_advisory_lock` before `migrate()`; release in `finally`.
4. Set bounded `lock_timeout` and `statement_timeout` session variables before lock/migrate.
5. Document migrations as a one-shot deployment job (not API/worker/cron startup side effect).
6. Add integration scenario aligned with **V-06** (two parallel processes serialize safely).

**Smallest correct scope:** advisory-lock serialization in `apps/migrations` production runner + bounded timeouts + docs + V-06 int-spec.

## Out of scope

- Nest modules, infrastructure DI, or contracts changes.
- API readiness gating on migration state.
- Changing health endpoints or runtime app bootstrap.
- Unifying `db:migrate` (drizzle-kit) with the locked production runner unless human approves expansion (see open questions).
- Moving lock helper to `libs/infrastructure` or `libs/shared` unless human approves broader refactor.
- README backlog index resolution updates.

## Files to create

| Path                                              | Responsibility                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/migrations/src/run-migrations.ts`           | Exported `runMigrations()`: connect → set timeouts → acquire lock → `migrate()` → unlock → release.                                                                       |
| `apps/migrations/src/migration-lock.constants.ts` | Stable advisory lock key(s) documented as project-scoped (e.g. two-int `pg_advisory_lock(key1, key2)`).                                                                   |
| `apps/migrations/src/migration-lock.ts`           | `acquireMigrationAdvisoryLock(client, options)` / `releaseMigrationAdvisoryLock(client)` with bounded wait and clear error messages.                                      |
| `apps/migrations/src/run-migrations.int-spec.ts`  | **V-06** integration scenario: two parallel migration processes serialize safely; skip when PostgreSQL unavailable (pattern from `drizzle-outbox-processor.int-spec.ts`). |

## Files to modify

| Path                                                     | Symbol / responsibility                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/migrations/src/main.ts`                            | Thin bootstrap: import and call exported `runMigrations()`; preserve exit-code behavior and logging.                  |
| `AGENTS.md`                                              | Migrations entrypoint section — state one-shot deployment job contract and advisory-lock serialization for prod path. |
| `DOCKER_PRODUCTION.md`                                   | Note parallel-run safety via advisory lock; clarify migrations service is not a long-running sidecar.                 |
| `.env.example` (optional, if timeouts made configurable) | Document `MIGRATION_LOCK_TIMEOUT_MS`, `MIGRATION_STATEMENT_TIMEOUT_MS`.                                               |

## Files to delete

None.

## Contract and DI changes

**None.**

- Migrations entrypoint remains a standalone script (no Nest bootstrap).
- No new `@contracts` tokens or infrastructure providers.
- No composition-root registration changes.

## Implementation steps

1. **Create `migration-lock.constants.ts`** with a documented stable lock id. Recommended default: two-int keys derived from a fixed project namespace (e.g. `pg_advisory_lock(20260621, 1)`) to avoid collisions with unrelated advisory-lock users in the same database.

2. **Create `migration-lock.ts`:**
   - `acquireMigrationAdvisoryLock(client, { lockTimeoutMs })` — `SET lock_timeout`, then `SELECT pg_advisory_lock($1, $2)` (or single-key variant per human decision).
   - `releaseMigrationAdvisoryLock(client)` — `SELECT pg_advisory_unlock(...)`; swallow/log unlock errors idempotently (session disconnect already releases locks).
   - Throw a clear, credential-free error when lock acquisition times out.

3. **Create `run-migrations.ts`:**

   ```text
   pool = new Pool({ max: 1, connectionTimeoutMillis: 10_000 })
   client = await pool.connect()
   try {
     SET statement_timeout (bounded DDL)
     acquireMigrationAdvisoryLock(client)
     db = drizzle(client)
     await migrate(db, { migrationsFolder })
   } finally {
     releaseMigrationAdvisoryLock(client)   // even on migrate failure
     client.release()
     await pool.end()
   }
   ```

   Export `runMigrations()` for tests; keep env validation (`DATABASE_URL`, `MIGRATIONS_FOLDER`) here.

4. **Refactor `main.ts`** to call exported `runMigrations()` and retain existing `process.exitCode = 1` error handling.

5. **Create `run-migrations.int-spec.ts` (**V-06**):**
   - `isPostgresAvailable()` helper (same pattern as `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts`).
   - Scenario A: spawn two concurrent `runMigrations()` calls (or child processes on built `main.js`); assert both exit successfully, migration journal is consistent, no duplicate-application DDL errors.
   - Scenario B (lighter fallback): lock helper — second acquire blocks until first releases within timeout.
   - Skip suite when PostgreSQL unavailable; do not fail CI solely due to missing infra.

6. **Documentation updates:**
   - `AGENTS.md` — migrations are a dedicated one-shot deployment process; API/worker/cron must not run migrations on startup.
   - `DOCKER_PRODUCTION.md` — note advisory-lock serialization; safe to run `docker compose run --rm migrations` concurrently with an in-flight migration job (second waits, then succeeds or times out).

7. **Optional env configurability** (only if human approves in open questions): read `MIGRATION_LOCK_TIMEOUT_MS` / `MIGRATION_STATEMENT_TIMEOUT_MS` from env with conservative defaults; document in `.env.example`.

## Migration and rollout concerns

- **Existing deployments:** No schema change; behavior change is runtime-only (serialization instead of race).
- **First deploy with fix:** Single migration job behaves as today; parallel jobs now queue instead of racing.
- **Lock holder crash:** PostgreSQL releases session advisory locks on disconnect — safe; next runner retries.
- **Long migrations:** `statement_timeout` must exceed worst-case migration duration or prod migrations will fail mid-flight.
- **Dev path gap:** Teams using `npm run db:migrate` / drizzle-kit directly still have no lock unless separately addressed.
- **Shared database:** Stable lock id is global per database — correct for single-app starter kit; problematic if multiple unrelated apps share one DB (open question).

## Targeted verification

| Command                                                                | Purpose                                    |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `npm run build:migrations`                                             | Compiles migrations entrypoint             |
| `npx tsc -p apps/migrations/tsconfig.app.json --noEmit --pretty false` | Typecheck migrations app                   |
| `npm run test:int -- apps/migrations/src/run-migrations.int-spec.ts`   | **V-06** integration (requires PostgreSQL) |

**V-06 manual scenario (safe known DB only):**

```bash
npm run build:migrations
# Terminal 1 & 2 in parallel:
npm run start:prod:migrations
# Expected: one runs, one waits; both exit 0; no DDL race errors
```

## Full verification

| Command             | Notes                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `npm run build`     | All four entrypoints compile                                       |
| `npm run lint`      | Record result; baseline may fail independently on **P2-11**        |
| `npm run test:int`  | Includes new migrations int-spec                                   |
| `npm run test:unit` | Regression signal; migrations change unlikely to affect unit suite |

## Acceptance criteria

| Requirement (from backlog)                     | Verification                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Dedicated connection for lock + migrate        | Code review: `pool.connect()` → single `Client` used for lock, `drizzle(client)`, unlock                   |
| `pg_advisory_lock` before `migrate()`          | Code review + int-spec                                                                                     |
| `unlock` + release in `finally`                | Code review + int-spec (lock released on migration failure)                                                |
| Bounded lock wait / statement timeout          | Session `lock_timeout` / `statement_timeout` (or env-driven equivalents); test timeout path where feasible |
| Document migrations as one-shot deployment job | `AGENTS.md`, `DOCKER_PRODUCTION.md`                                                                        |
| Integration scenario: two parallel processes   | `run-migrations.int-spec.ts` + **V-06** report                                                             |
| No regression on build                         | `npm run build:migrations` exit 0                                                                          |
| API/worker/cron do not migrate on startup      | Static check (already true); documented                                                                    |

## Risks

| Risk                                        | Mitigation                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Lock on wrong connection (Pool round-robin) | Mandatory `pool.connect()` + same `client` for lock/migrate/unlock          |
| `statement_timeout` too aggressive          | Conservative defaults + optional env override; document in `.env.example`   |
| `db:migrate` path still racy                | Document as dev-only or follow-up to delegate to locked runner              |
| int-spec skipped without PostgreSQL         | Mark **V-06** `not-confirmed` if PG unavailable; do not claim runtime proof |
| Duplicate unlock on crashed session         | Idempotent error handling on unlock failure                                 |

## Rollback strategy

- Revert P2-01 commit(s): restores prior unlocked behavior.
- No DB migration rollback required (no schema changes from this fix).
- In-flight parallel jobs during rollback window regain race risk — coordinate deploys.

## Open questions requiring human decision

1. **Scope `db:migrate` (drizzle-kit):** Should dev/CI script invoke the locked production runner (`build:migrations` + `db:migrate:prod`), or is locking prod-only acceptable?
2. **Lock key strategy:** Single `bigint` vs two-int `pg_advisory_lock(key1, key2)` vs `hashtext('namespace')` — pick one documented constant for the starter kit.
3. **Default timeouts:** Values for `lock_timeout` and `statement_timeout` (e.g. 60s wait / 30min statement?) — environment-specific?
4. **Configurable lock id via env:** Needed for forked projects sharing one PostgreSQL cluster?
5. **Test location:** Keep all new code under `apps/migrations/` vs extract lock helper to `libs/shared` for reuse?
6. **P2-11 lint baseline:** Verification should note lint may fail independently until **P2-11** is resolved.
