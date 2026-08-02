# P2-17 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-17-fail-closed-integration-tests-without-postgres.md` (`status: approved`)

## Changed files

- `test/integration/infra-availability.ts` (created)
- `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts`
- `apps/migrations/src/run-migrations.int-spec.ts`
- `apps/worker/src/processors/email.processor.int-spec.ts`
- `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts`
- `jest.integration.config.ts`
- `AGENTS.md`
- `README.md`
- `docs/agent-plans/INDEX.md` (P2-17 row status `proposed` → `approved`)
- `docs/agent-reports/P2-17-implementation.md` (this report)

## Completed steps

1. Baseline: with soft-skip behavior, `jest --config jest.integration.config.ts` reported **4 suites / 8 tests passed** in ~2s while local Postgres/Redis were unreachable (silent green).
2. Added shared fail-closed helpers `assertPostgresAvailable` / `assertRedisAvailable` in `test/integration/infra-availability.ts` (~2s connect timeouts; clear error naming `npm run test:int` and the target).
3. Wired all four `*.int-spec.ts` suites via relative imports; removed local probes and soft-skip early returns from `it` bodies.
4. Outbox keeps table probe via `probeSql: 'SELECT 1 FROM outbox_events LIMIT 1'`.
5. Documented fail-closed policy in `AGENTS.md` and `README.md`; noted `test:all` still excludes `test:int`.
6. Updated `docs/agent-plans/INDEX.md` plan status to `approved`.
7. Did **not** add `INTEGRATION_ALLOW_SKIP` (plan Open question #3 / step 8: no hatch).

## Deviations

- Added `infraReady` / uninitialized-resource guards in `beforeEach`/`afterEach` for outbox, email, and cache suites so Jest cleanup after a failed `beforeAll` does not throw secondary `TypeError`s. This is teardown hygiene only — `it` bodies have no soft-skip returns.
- Optional `probeSql` on `assertPostgresAvailable` so outbox retains its `outbox_events` table probe (plan risk called this out as acceptable).
- AC-02 infra-up green run could not be executed: Docker Desktop pipe unavailable; localhost Postgres/Redis unreachable. Assert bodies remain intact by static inspection.
- Verification used `node node_modules/jest/bin/jest.js --config jest.integration.config.ts` because bare `npm run test:int` (`jest` wrapper) crashed with Windows access violation (`-1073741819`). `package.json` was not changed (out of plan scope).

## Commands executed

| Command                                                                                                                 | Result                                                | Conclusion                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `node node_modules/jest/bin/jest.js --config jest.integration.config.ts` (baseline, pre-change)                         | exit 0; 4 suites / 8 tests passed (~2s)               | Soft-green baseline confirmed                                 |
| `npm run test:int`                                                                                                      | exit `-1073741819` (empty output)                     | Windows Jest npm wrapper crash; used direct Jest path instead |
| `DATABASE_URL=...@127.0.0.1:1/... REDIS_HOST=127.0.0.1 REDIS_PORT=1` + Jest int `--runInBand --forceExit` (post-change) | exit 1; 4 failed / 8 failed; fail-closed probe errors | **AC-01** satisfied                                           |
| Jest int with default localhost targets (post-change)                                                                   | exit 1; 4 failed / 8 failed (Postgres/Redis down)     | Infra unavailable; not a soft-green pass                      |
| `docker compose ps`                                                                                                     | Docker Desktop engine pipe missing                    | Could not start Postgres/Redis for AC-02                      |
| `npm run lint`                                                                                                          | exit 0                                                | Pass                                                          |
| `npm run test:unit`                                                                                                     | exit 0; 43 suites / 274 tests passed                  | Unit gate unaffected                                          |
| Grep `*.int-spec.ts` for soft-skip `postgresAvailable`/`redisAvailable` returns                                         | no matches                                            | Soft-skip removed                                             |
| Docs grep `AGENTS.md` / `README.md` for fail-closed policy                                                              | present                                               | **AC-03** satisfied                                           |

## Command results

- Fail-closed: missing Postgres/Redis → non-zero exit; suites fail with explicit `fail-closed; must not soft-pass` errors.
- No soft-green path remains in int-specs.
- Lint and unit gates pass.
- Infra-up execution of outbox lease/heartbeat asserts: **not runtime-proven** (services unavailable).

## Acceptance criteria self-check

- **AC-01:** Met — infra-down `test:int` is non-zero / failed (8 failed), not soft-green.
- **AC-02:** Code complete (lease/heartbeat `it` bodies unchanged aside from removed soft-skip); **runtime green not confirmed** (Postgres/Redis/Docker unavailable).
- **AC-03:** Met — `AGENTS.md` and `README.md` state fail-closed policy and interpretation for agents/operators.

## Remaining risks

- AC-02 needs an independent verifier run with `docker compose up -d postgres redis` (and migrated schema / `outbox_events`) to confirm green outbox/migrations/email/cache asserts.
- Open-handle / force-exit on `test:int` remains (tracked as P3-09); `--forceExit` used only for verification convenience.
- `npm run test:int` still uses bare `jest` and can crash on Windows npm wrapper; other scripts already use `node node_modules/jest/bin/jest.js` (possible follow-up, not P2-17).
- P3-09 plan text still mentions old local `isRedisAvailable` / soft-skip helpers — documentation drift only until that plan is implemented.

## Unverified areas

- Full green `test:int` against live PostgreSQL + Redis.
- Bootstrap of API/Worker/Cron (not required by plan).
- `npm run build` (plan: optional for test-only/docs change; not run).
