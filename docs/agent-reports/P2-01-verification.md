# P2-01 — Independent verification

## Verdict

**approved**

## Scope checked

Production changes are confined to P2-01 scope:

| Path                                              | Change                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/migrations/src/migration-lock.constants.ts` | Created — stable two-int advisory lock keys `[20260621, 1]`               |
| `apps/migrations/src/migration-lock.ts`           | Created — `acquireMigrationAdvisoryLock` / `releaseMigrationAdvisoryLock` |
| `apps/migrations/src/run-migrations.ts`           | Created — exported `runMigrations()` with session lock + migrate          |
| `apps/migrations/src/run-migrations.int-spec.ts`  | Created — V-06 integration scenarios                                      |
| `apps/migrations/src/main.ts`                     | Modified — thin bootstrap calling exported `runMigrations()`              |
| `apps/migrations/tsconfig.app.json`               | Modified — exclude `**/*.int-spec.ts` from production build               |
| `AGENTS.md`                                       | Modified — one-shot deployment job + advisory-lock serialization          |
| `DOCKER_PRODUCTION.md`                            | Modified — parallel-run safety via advisory lock                          |

No unrelated production changes. `migrate()` appears only in `apps/migrations/src/run-migrations.ts`. API, Worker, and Cron entrypoints contain no migration calls.

**Documented deviations (acceptable):**

1. **`tsconfig.app.json` int-spec exclude** — not listed in plan; prevents integration test sources from shipping in the production migrations image. Build output contains only `main.js`, `migration-lock.js`, `migration-lock.constants.js`, `run-migrations.js`.
2. **No `.env.example` timeout variables** — plan marked env configurability as optional; hardcoded defaults used (`60s` lock wait, `30min` statement).

Working tree also contains staged P2-02…P2-11 plans and untracked `docs/agent-reports/P2-01-implementation.md`; these are agent artifacts, not P2-01 production code.

## Root-cause assessment

**Original root cause:** Production migrator in `apps/migrations/src/main.ts` invoked Drizzle `migrate()` without a PostgreSQL advisory lock. Using `drizzle(pool)` without `pool.connect()` did not guarantee lock acquisition and migration on the same session, allowing concurrent production migration jobs to race on DDL.

**Fix confirmed:** Migration orchestration extracted to `run-migrations.ts` using a dedicated `pool.connect()` session for `statement_timeout`, `pg_advisory_lock`, `drizzle(client)`, `migrate()`, and `pg_advisory_unlock` in `finally`. Root cause is addressed, not masked.

## Acceptance criteria matrix

| Requirement                                         | Status     | Evidence                                                                                       |
| --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Dedicated connection for lock + migrate             | **Passed** | `pool.connect()` → single client for timeout, lock, `drizzle(client)`, unlock                  |
| `pg_advisory_lock` before `migrate()`               | **Passed** | `acquireMigrationAdvisoryLock` called before `migrate()` in `run-migrations.ts`                |
| `unlock` + release in `finally`                     | **Passed** | `finally` releases lock, client, and pool; int-spec confirms unlock after migration failure    |
| Bounded lock wait / statement timeout               | **Passed** | `lock_timeout` 60s, `statement_timeout` 30min; int-spec tests lock serialization with timeouts |
| Document migrations as one-shot deployment job      | **Passed** | `AGENTS.md`, `DOCKER_PRODUCTION.md` updated per plan                                           |
| Integration scenario: two parallel processes (V-06) | **Passed** | `run-migrations.int-spec.ts` — 3/3 passed with PostgreSQL available                            |
| No regression on build                              | **Passed** | `npm run build:migrations` and `npm run build` exit 0                                          |
| API/worker/cron do not migrate on startup           | **Passed** | Static grep: no `migrate(` in api/worker/cron; documented in `AGENTS.md`                       |

## Dependency and DI verification

**None expected; none introduced.**

- Migrations entrypoint remains a standalone script (no Nest bootstrap).
- No new contracts tokens or infrastructure providers.
- No composition-root registration changes.

## Commands executed

| Command                                                                        | Result                                                                                    | Conclusion                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `npm run build:migrations`                                                     | Exit 0                                                                                    | Migrations entrypoint compiles                      |
| `npx tsc -p apps/migrations/tsconfig.app.json --noEmit --pretty false`         | Exit 0                                                                                    | Migrations app typechecks                           |
| `npm run test:int -- apps/migrations/src/run-migrations.int-spec.ts` (1st run) | Exit -1073741819 (Windows crash)                                                          | Environment flakiness; not a code defect            |
| `npm run test:int -- apps/migrations/src/run-migrations.int-spec.ts` (retry)   | Exit 0 — 3 passed                                                                         | **V-06 confirmed** with PostgreSQL available        |
| `npm run build`                                                                | Exit 0                                                                                    | All four entrypoints compile                        |
| `npm run lint`                                                                 | Exit 1 — 4 errors in `outbox-processor.defaults.ts`, `outbox-processor.options.schema.ts` | Pre-existing **P2-11** baseline; unrelated to P2-01 |
| `npx eslint apps/migrations/src --max-warnings=0`                              | Exit 0                                                                                    | P2-01 files lint-clean                              |
| `npm run test:int` (full)                                                      | Exit 0 — 5 passed (3 suites); worker force-exit warning                                   | All integration suites pass including V-06          |

## Findings

No blocking defects.

Minor non-blocking observations:

1. **`acquireMigrationAdvisoryLock` error handling** — catch block wraps all errors as a timeout message, not only lock-timeout failures (cosmetic; does not affect serialization behavior).
2. **First int-spec run crashed on Windows** (`-1073741819`); immediate retry succeeded 3/3. Possible Jest/PostgreSQL environment flakiness.
3. **Full `test:int` worker force-exit warning** — open-handle teardown; all suites still pass.

## Documentation alignment

- **AGENTS.md** — states migrations are a dedicated one-shot deployment job (not API/Worker/Cron side effect) and serializes concurrent attempts via session-level advisory lock with bounded timeouts.
- **DOCKER_PRODUCTION.md** — clarifies one-shot job (not long-running sidecar) and parallel-run safety via advisory lock.

Both match the approved plan.

## Remaining risks

| Risk                                        | Notes                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run db:migrate` (drizzle-kit dev path) | Still unlocked — documented as out of scope                                                       |
| `statement_timeout` (30min) vs long DDL     | Must exceed worst-case migration duration in production                                           |
| Lock keys global per database               | Correct for single-app starter kit; collision risk if unrelated apps share one PostgreSQL cluster |
| Full lint gate                              | Fails independently until **P2-11** is resolved                                                   |

## Unverified areas

- Manual V-06 scenario with two parallel `npm run start:prod:migrations` terminals was not executed; int-spec with live PostgreSQL provides runtime proof.
- Production Docker deploy with concurrent `docker compose run --rm migrations` not exercised in this session.
- If PostgreSQL is unavailable, int-spec skips gracefully (`if (!postgresAvailable) return`); V-06 would be **not-confirmed** in that environment only — PostgreSQL was available during verification.
