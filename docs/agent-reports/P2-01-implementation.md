# P2-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-01-serialize-parallel-postgresql-migrations.md` (`status: approved`)

## Changed files

| Path                                              | Change                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/migrations/src/migration-lock.constants.ts` | **Created** — stable two-int advisory lock keys `[20260621, 1]`                                                                             |
| `apps/migrations/src/migration-lock.ts`           | **Created** — `acquireMigrationAdvisoryLock` / `releaseMigrationAdvisoryLock` with bounded `lock_timeout` and credential-free timeout error |
| `apps/migrations/src/run-migrations.ts`           | **Created** — exported `runMigrations()`: dedicated `pool.connect()` session, `statement_timeout`, lock, `migrate()`, unlock in `finally`   |
| `apps/migrations/src/main.ts`                     | Thin bootstrap calling exported `runMigrations()`; preserved `process.exitCode = 1` on failure                                              |
| `apps/migrations/src/run-migrations.int-spec.ts`  | **Created** — V-06 integration: lock serialization, parallel `runMigrations()`, lock release on migration failure                           |
| `apps/migrations/tsconfig.app.json`               | Exclude `**/*.int-spec.ts` from production build output                                                                                     |
| `AGENTS.md`                                       | Document one-shot deployment job contract and advisory-lock serialization                                                                   |
| `DOCKER_PRODUCTION.md`                            | Document parallel-run safety via advisory lock                                                                                              |

## Completed steps

1. Created `migration-lock.constants.ts` with documented two-int lock keys.
2. Created `migration-lock.ts` with session `lock_timeout`, `pg_advisory_lock`, idempotent unlock, and clear timeout error.
3. Created `run-migrations.ts` using a single dedicated `Client` for lock + `drizzle(client)` + `migrate()` + unlock in `finally`.
4. Refactored `main.ts` to import and call exported `runMigrations()`.
5. Created `run-migrations.int-spec.ts` with V-06 scenarios (lock helper + parallel runners + failure unlock).
6. Updated `AGENTS.md` and `DOCKER_PRODUCTION.md` per plan.
7. Excluded int-spec from migrations production compile (`tsconfig.app.json`).

## Deviations

| Deviation                                                               | Rationale                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added `**/*.int-spec.ts` to `apps/migrations/tsconfig.app.json` exclude | Prevents integration test sources from being compiled into the production migrations image; not listed in plan but does not change runtime behavior   |
| Did not add optional `.env.example` timeout variables                   | Plan marked env configurability as optional pending open-question approval; used conservative hardcoded defaults (`60s` lock wait, `30min` statement) |

## Commands executed

```bash
npm run build:migrations
npx tsc -p apps/migrations/tsconfig.app.json --noEmit --pretty false
npm run test:int -- apps/migrations/src/run-migrations.int-spec.ts
npm run build
npm run lint
npx eslint apps/migrations/src --max-warnings=0
npm run test:unit
npm run test:int
```

## Command results

| Command                                                              | Result                             | Conclusion                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:migrations`                                           | Exit 0                             | Migrations entrypoint compiles                                                                                                                 |
| `npx tsc -p apps/migrations/tsconfig.app.json --noEmit`              | Exit 0                             | Migrations app typechecks                                                                                                                      |
| `npm run test:int -- apps/migrations/src/run-migrations.int-spec.ts` | Exit 0 — 3 tests passed            | **V-06 confirmed** with PostgreSQL available                                                                                                   |
| `npm run build`                                                      | Exit 0                             | All four entrypoints compile                                                                                                                   |
| `npm run lint` (full)                                                | Exit 1                             | Pre-existing failures in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (**P2-11** baseline); not introduced by P2-01 |
| `npx eslint apps/migrations/src`                                     | Exit 0                             | No lint issues in P2-01 files                                                                                                                  |
| `npm run test:unit` (full)                                           | Exit 1 — 63 passed, 1 failed       | Failure in `outbox-processor.options.schema.spec.ts` (pre-existing); unrelated to migrations                                                   |
| `npm run test:int` (full)                                            | Exit 0 — 5 tests passed (3 suites) | All integration suites pass including new V-06 spec                                                                                            |

## Acceptance criteria self-check

| Requirement                                    | Status                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Dedicated connection for lock + migrate        | Pass — `pool.connect()` → single client for lock, `drizzle(client)`, unlock |
| `pg_advisory_lock` before `migrate()`          | Pass — code review + int-spec                                               |
| `unlock` + release in `finally`                | Pass — code review + failure int-spec                                       |
| Bounded lock wait / statement timeout          | Pass — `lock_timeout` 60s, `statement_timeout` 30min                        |
| Document migrations as one-shot deployment job | Pass — `AGENTS.md`, `DOCKER_PRODUCTION.md`                                  |
| Integration scenario: two parallel processes   | Pass — `run-migrations.int-spec.ts` (3/3 with PostgreSQL)                   |
| No regression on build                         | Pass — `npm run build:migrations` and `npm run build` exit 0                |
| API/worker/cron do not migrate on startup      | Pass — static check unchanged; documented in `AGENTS.md`                    |

## Remaining risks

- `npm run db:migrate` (drizzle-kit dev path) remains unlocked — documented as out of scope.
- `statement_timeout` (30min) must exceed worst-case migration duration in production or long DDL will fail mid-flight.
- Lock keys are global per database — correct for single-app starter kit; problematic if unrelated apps share one PostgreSQL cluster.
- Full lint gate still fails independently until **P2-11** is resolved.

## Unverified areas

- Manual V-06 scenario with two parallel `npm run start:prod:migrations` terminals was not executed; runtime proof comes from int-spec with live PostgreSQL.
- Production Docker deploy with concurrent `docker compose run --rm migrations` not exercised in this session.
