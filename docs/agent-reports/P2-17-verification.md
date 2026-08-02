# P2-17 — Independent verification

## Verdict

not-confirmed

## Scope checked

- Backlog: `P2-17` present in `docs/agent-backlog/INDEX.md` (Medium / Confirmed defect) and fully stated under `## P2-17` in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`.
- Plan: `docs/agent-plans/P2-17-fail-closed-integration-tests-without-postgres.md` with frontmatter `status: approved`.
- Implementation report: `docs/agent-reports/P2-17-implementation.md` (consulted; not trusted without independent evidence).
- Git scope for this fix (working tree vs `HEAD`):
  - **Created:** `test/integration/infra-availability.ts`
  - **Modified:** four `*.int-spec.ts` files, `jest.integration.config.ts`, `AGENTS.md`, `README.md`, `docs/agent-plans/INDEX.md` (plan row `proposed` → `approved`)
  - **Report-only:** `docs/agent-reports/P2-17-implementation.md`
- Diff removes soft-skip probe helpers and early `return`s in `it` bodies; adds shared fail-closed asserts. No production Nest modules, ports, tokens, HTTP controllers, OpenAPI, or Postman changes.
- Documented deviation: `infraReady` / uninitialized-resource guards in `beforeEach`/`afterEach` (outbox, email, cache) so failed `beforeAll` does not cause secondary teardown `TypeError`s. `it` bodies no longer soft-skip. Acceptable and consistent with plan intent.
- Optional `probeSql` on Postgres assert preserves outbox `outbox_events` table probe (called out as acceptable in plan risks).
- No `INTEGRATION_ALLOW_SKIP` hatch (matches plan Open question #3 default / step 8).
- P2-17 file set does not mix other backlog issues.

## Root-cause assessment

**Original root cause:** per-suite `isPostgresAvailable` / `isRedisAvailable` soft-skipped assertions (`console.warn` + early `return` in hooks/`it`), so Jest counted missing-infra cases as passed.

**Fix addresses root cause:** shared fail-closed `assertPostgresAvailable` / `assertRedisAvailable` throw clear errors naming `npm run test:int` and the target; all four int-specs call them from `beforeAll` and no longer early-return inside `it` on missing infra. Fresh runtime evidence with unreachable Postgres/Redis: **4 failed suites / 8 failed tests / exit 1**, with messages containing `fail-closed; must not soft-pass`. Soft-green path is removed.

This is not symptom suppression (no force-pass, skip wrapper, or hatch).

## Acceptance criteria matrix

| ID         | Source                       | Criterion                                                                                                  | Result            | Evidence                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01      | Issue + plan                 | Running `test:int` without PostgreSQL cannot report a fully green suite that implies outbox DB asserts ran | **passed**        | Unreachable Postgres/Redis: Jest exit 1; 4 failed / 8 failed; outbox failures from `assertPostgresAvailable` with fail-closed message. Grep of `*.int-spec.ts`: no `postgresAvailable`/`redisAvailable`/`isPostgresAvailable`/`isRedisAvailable` soft-skip remains.                                                          |
| AC-02      | Issue + plan                 | When PostgreSQL is available, existing outbox lease/heartbeat asserts still run                            | **not-confirmed** | Static: lease/heartbeat `it` bodies and `expect(...)` set match `HEAD` (soft-skip returns only removed). Runtime green `test:int` with live Postgres + Redis **not executed**: localhost `5432`/`6379` closed; Docker Desktop engine unavailable (`docker compose ps` failed). Plan requires infra-up execution for this AC. |
| AC-03      | Issue + plan                 | Docs state the chosen skip/fail policy for operators and agents                                            | **passed**        | `AGENTS.md` states missing Postgres/Redis **fails** the suite and green `test:int` means live asserts ran. `README.md` §26-style notes: **fail-closed**, non-zero on missing infra, no soft-skip.                                                                                                                            |
| Implied #2 | Issue required change + plan | Redis-probing int-specs use same fail-closed policy                                                        | **passed**        | Email + Redis cache suites call `assertRedisAvailable` in `beforeAll`; infra-down run failed those suites with fail-closed Redis errors (not soft-pass).                                                                                                                                                                     |

## Dependency and DI verification

- No Nest DI / composition-root / contract token changes.
- Test helper lives under `test/integration/` (test-only); int-specs use relative imports.
- `jest.integration.config.ts` only adds a fail-closed policy comment; no `moduleNameMapper` required (relative imports resolve).

## Commands executed

Command:
`Test-NetConnection 127.0.0.1:5432` / `:6379`; `docker compose ps`
Result:
TcpTestSucceeded False / False; Docker engine pipe unavailable (`dockerDesktopLinuxEngine` missing)
Conclusion:
Infrastructure unavailable — cannot prove AC-02 at runtime; infra-down path used for AC-01

Command:
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/app REDIS_HOST=127.0.0.1 REDIS_PORT=1` + `node node_modules/jest/bin/jest.js --config jest.integration.config.ts --runInBand --forceExit`
Result:
exit 1; Test Suites 4 failed; Tests 8 failed; fail-closed Postgres/Redis probe errors (`must not soft-pass`)
Conclusion:
**AC-01 passed** (not soft-green)

Command:
`node node_modules/jest/bin/jest.js --config jest.integration.config.ts --runInBand --forceExit` (default localhost after clearing forced env)
Result:
exit 1; 4 failed / 8 failed; localhost Postgres/Redis unreachable with fail-closed messages
Conclusion:
Default targets also fail-closed when services are down (infrastructure unavailability, not product defect)

Command:
Static grep `*.int-spec.ts` for `postgresAvailable` / `redisAvailable` / `isPostgresAvailable` / `isRedisAvailable` / soft-skip warn
Result:
no matches
Conclusion:
Soft-skip pattern removed from int-specs

Command:
Compare outbox lease/heartbeat asserts vs `HEAD`
Result:
Same insert / claim / processPending / expect structure; only availability soft-skips removed
Conclusion:
Assert bodies intact statically; runtime execution still **not-confirmed**

Command:
`npm run lint`
Result:
exit 0 (`eslint . --max-warnings=0`)
Conclusion:
Lint pass

Command:
`node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand --forceExit`
Result:
exit 0; 43 suites / 274 tests passed
Conclusion:
Unit gate unaffected by P2-17

Command:
`npm run build`
Result:
Not run
Conclusion:
Plan marks build optional for test-only/docs change

Command:
OpenAPI / Postman coverage
Result:
N/A — no HTTP endpoint diff
Conclusion:
Skipped per plan and observed scope

## Findings

1. **Blocking for approval:** AC-02 lacks runtime evidence with PostgreSQL (and Redis) up. Static inspection strongly suggests lease/heartbeat bodies will run once probes succeed, but the skill/plan require live execution.
2. Fail-closed policy is correctly implemented for all four int-specs; AC-01 and AC-03 met.
3. `infraReady` teardown guards are justified and do not restore soft-pass inside `it`.
4. Open-handle / force-exit on `test:int` still observed — tracked as P3-09, not a P2-17 regression of the soft-green defect.
5. `package.json` `test:int` still uses bare `jest` while `AGENTS.md` claims Jest scripts use `node node_modules/jest/bin/jest.js`. Pre-existing / adjacent drift; not required by P2-17 plan to change `package.json`.
6. Some Postgres probe failure messages show `Probe failed: AggregateError` without expanded child messages when `AggregateError.errors` is empty/unenumerable in this Node/pg path. Suites still fail; message quality only.
7. P3-09 plan text still describes old local soft-skip helpers — documentation drift until that plan is updated/implemented.

## Documentation alignment

- `AGENTS.md` and `README.md` state fail-closed interpretation aligned with approved plan.
- Plan INDEX row for P2-17 is `approved`, matching plan frontmatter.
- No production runtime docs beyond test-gate policy were required.

## Remaining risks

- Without a green infra-up run, a latent import/path or schema-probe regression on the happy path cannot be ruled out (especially outbox `probeSql` requiring `outbox_events`).
- Developers without Compose will see intentional failures; docs mitigate.
- Windows Jest npm-wrapper instability can obscure gate results if operators do not use the direct Jest binary path.

## Unverified areas

- Full green `npm run test:int` against live PostgreSQL + Redis with migrated schema / `outbox_events` (AC-02).
- Entrypoint bootstrap (`start:api` / worker / cron) — not required by plan.
- `npm run build` — optional per plan.
- CI wiring of `test:int` — out of scope (P2-23).
