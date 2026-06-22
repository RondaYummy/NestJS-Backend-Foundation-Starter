---
issue_id: P3-04
status: approved
owner: human-approval-required
---

# P3-04 — Ізолювати unit suite timeout та open handles

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-04 (Low, Production/tooling risk).

Related verification backlog: **V-14** (unit suite timeout / ts-jest configuration).

## Investigation notes (2026-06-22)

**Branch state:** P3-04 issue confirmed in backlog; no existing plan. Unrelated untracked plans for P1-06, P1-07, P2-12, P2-13 only.

**Defect status:** **Confirmed — not stale.** `jest.unit.config.ts` still uses broad `testMatch: ['**/*.spec.ts']`, so `npm run test:unit` runs pure unit tests, Nest module bootstrap specs, and release-policy specs in one command.

**Evidence commands (planner run, Node 24.12.0, `npm ci` fresh):**

| Command                                                                                                     | Result                                                   | Conclusion                                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run test:unit -- --runInBand --detectOpenHandles`                                                      | Exit 0 — 23 suites, 118 tests, **56.9 s** (cold compile) | Suite completes locally but is slow; many ts-jest TS151002 warnings      |
| `npm run test:unit -- --detectOpenHandles` (parallel)                                                       | Exit 0 — 23 suites, 118 tests, **6.1 s**                 | Parallel default is much faster                                          |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand --detectOpenHandles` (2nd run) | Exit 0 — 23 suites, 118 tests, **6.7 s**                 | Warm cache; no open-handle failure reported                              |
| `npm run test:unit -- --runInBand --testPathPatterns=drizzle.module.spec`                                   | Exit **-1073741819** (Windows access violation)          | Reproduces intermittent npm/Jest wrapper crash documented in P2-08/P2-11 |
| `node node_modules/jest/bin/jest.js ... --testPathPatterns=drizzle.module.spec --runInBand`                 | Exit 0 — 1 test, **3.2 s**                               | Targeted spec passes via direct node invocation                          |
| `jest --listTests` (unit config)                                                                            | **23** `*.spec.ts` files                                 | Includes 6 `*.module.spec.ts` + `scripts/release/release-policy.spec.ts` |

**Backlog review evidence (baseline 51):** `npm run test:unit -- --runInBand` did **not** finish within a **240 s** tool timeout; ts-jest warned about `module=Node16` without `isolatedModules`.

**Current spec inventory (23 files under unit config):**

| Bucket           | Files                                    | Notes                                                                                                                          |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pure unit        | 17 files                                 | Mocks/fakes only; no external infra (e.g. `drizzle-outbox-processor.spec.ts`, `env.schema.spec.ts`, `email.processor.spec.ts`) |
| Module bootstrap | 6 `*.module.spec.ts`                     | `Test.createTestingModule` DI wiring                                                                                           |
| Release policy   | `scripts/release/release-policy.spec.ts` | Release tooling, not application runtime                                                                                       |

**High-risk bootstrap spec:** `libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts` boots `DrizzleModule.forRoot()` with a **real** `pg.Pool` (`postgresql://localhost:5432/test`). Pool shutdown relies on `DrizzleShutdown.onApplicationShutdown` via `moduleRef.close()`. Without PostgreSQL or with slow TCP failure, this spec can hang or leave sockets open — primary suspect for review timeout and flaky `--detectOpenHandles` behavior.

**Module specs with proper `moduleRef.close()` today:** `auth.module.spec.ts`, `mail.module.spec.ts`, `storage.module.spec.ts`, `redis.module.spec.ts` (also `jest.mock('ioredis')`), `drizzle.module.spec.ts`.

**Existing integration split:** `jest.integration.config.ts` already targets `**/*.int-spec.ts` (4 files). `npm run test:int` is separate and unchanged by this issue except documentation cross-links.

## Current behavior

1. `package.json` exposes `test:unit` → `jest --config jest.unit.config.ts` and `test:int` → `jest.integration.config.ts`.
2. `jest.unit.config.ts` matches **all** `**/*.spec.ts` (23 suites, 118 tests).
3. No `testTimeout`, `forceExit`, `detectOpenHandles`, or shared ts-jest `isolatedModules` configuration.
4. Root `tsconfig.json` uses `"module": "node16"` without `"isolatedModules": true`; ts-jest emits TS151002 on every compiled file.
5. Agents and `AGENTS.md` treat `npm run test:unit` as the default fast verification loop, but it includes slower Nest bootstrap and release-policy suites.
6. On Windows, `npm run test:unit` with certain flags intermittently crashes (`-1073741819`); direct `node node_modules/jest/bin/jest.js` is a known workaround (P2-08, P2-11 reports).
7. Backlog review could not obtain a completed verdict within 240 s when running the full unit command with `--runInBand`.

## Confirmed root cause

1. **Over-broad unit test selection** — one Jest config and one npm script mix fast pure-unit specs with Nest module bootstrap specs and release-policy specs. Agents expect `test:unit` to be a quick gate; bootstrap specs (especially real `pg.Pool` in `drizzle.module.spec.ts`) inflate runtime and can hang or leak handles when infra is absent or slow.
2. **Real PostgreSQL pool in a “unit” module spec** — `drizzle.module.spec.ts` constructs a live `pg.Pool` instead of mocking `pg` (contrast `redis.module.spec.ts` which mocks `ioredis`).
3. **ts-jest / TypeScript mismatch** — `module: node16` without `isolatedModules: true` causes per-file TS151002 diagnostics and extra compile overhead on cold runs.
4. **Tooling fragility on Windows** — npm → jest wrapper can crash under some flag combinations; no stable documented invocation in agent verification docs.

## Dependency/runtime flow

```text
npm run test:unit
  -> jest.unit.config.ts (testMatch: **/*.spec.ts)
       -> pure unit specs (fast, mocked)
       -> *.module.spec.ts (Nest Test.createTestingModule)
            -> drizzle.module.spec.ts -> real pg.Pool -> TCP to localhost:5432
            -> redis.module.spec.ts -> jest.mock('ioredis')
       -> scripts/release/release-policy.spec.ts

npm run test:int
  -> jest.integration.config.ts (testMatch: **/*.int-spec.ts)
       -> requires PostgreSQL / Redis when run (unchanged scope)

Agent verification loop (AGENTS.md)
  -> recommends npm run test:unit as default
  -> no separate module/bootstrap or release-policy commands today
```

No production API/Worker/Cron/Migrations runtime behavior changes. Impact is **developer/agent verification tooling and test hygiene** only.

## Goal

Provide a **predictable, fast** `test:unit` gate for agents and CI, move heavier bootstrap and release-policy suites to explicit commands, eliminate dangling handles from module specs, and document a stable local verification loop (including V-14).

## Scope

1. Split Jest configuration into three explicit buckets while keeping `test:int` for `*.int-spec.ts`:
   - **pure unit** (`test:unit`) — no external infrastructure, no Nest full-module bootstrap;
   - **module/bootstrap** (`test:module`) — `*.module.spec.ts` Nest DI wiring;
   - **release-policy** (`test:release`) — `scripts/release/**/*.spec.ts`.
2. Introduce shared Jest base config to DRY `moduleNameMapper` and ts-jest settings.
3. Fix `drizzle.module.spec.ts` to avoid a real `pg.Pool` (mock `pg` or explicit pool teardown pattern consistent with `redis.module.spec.ts`).
4. Audit remaining `*.module.spec.ts` files for lifecycle cleanup; add `afterAll`/`moduleRef.close()` only where missing.
5. Configure ts-jest with `isolatedModules: true` (via `tsconfig.jest.json` or inline `globals`) and suppress or resolve TS151002 without weakening root `tsconfig.json` production settings.
6. Add npm scripts and document agent verification commands in `AGENTS.md`, `README.md` (testing section), and backlog **V-14** instructions.
7. Optionally stabilize Windows invocation by routing Jest through `node node_modules/jest/bin/jest.js` in npm scripts (low-risk tooling fix aligned with prior agent reports).

## Out of scope

- Changing `*.int-spec.ts` files or `jest.integration.config.ts` behavior (except cross-link docs).
- Adding new business tests or increasing coverage unrelated to suite partitioning.
- Setting `forceExit: true` as a permanent workaround (only acceptable as temporary diagnostic, not acceptance criteria).
- Fixing unrelated Windows npm access-violation root cause in Node/npm itself (document workaround only).
- CI workflow changes unless a workflow already runs `test:unit` (none found under `.github/` today).
- Renaming every spec file (use `testMatch` / `testPathIgnorePatterns` conventions instead).

## Files to create

| Path                             | Responsibility                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `jest.config.base.ts`            | Shared preset, `moduleNameMapper`, ts-jest `isolatedModules`, default `testEnvironment: 'node'` |
| `jest.module.config.ts`          | `testMatch: ['**/*.module.spec.ts']`, moderate `testTimeout`, inherits base                     |
| `jest.release.config.ts`         | `testMatch: ['<rootDir>/scripts/release/**/*.spec.ts']`, inherits base                          |
| `tsconfig.jest.json` (if needed) | Jest-only `extends` of root tsconfig with `"isolatedModules": true`                             |

## Files to modify

| Path                                                              | Symbol / responsibility                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `jest.unit.config.ts`                                             | Narrow selection: exclude `*.module.spec.ts` and `scripts/release/`; import base; set `testTimeout` (~10 s) |
| `jest.integration.config.ts`                                      | Import shared base config (DRY only; keep `*.int-spec.ts` match)                                            |
| `package.json`                                                    | Add `test:module`, `test:release`, optional `test:all`; stabilize jest invocation                           |
| `libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts` | Replace real `pg.Pool` with `jest.mock('pg')` or explicit `pool.end()` in `afterAll`                        |
| `AGENTS.md`                                                       | Verification commands: `test:unit` (fast gate), `test:module`, `test:release`, `test:int`; V-14 note        |
| `README.md`                                                       | Testing / scripts section aligned with new commands                                                         |
| `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`         | § V-14 verification instructions only (command matrix, expected timings, open-handle check)                 |
| `EXAMPLES.md`                                                     | Update unit-test command table if it lists only `test:unit`                                                 |

## Files to delete

None.

## Contract and DI changes

None. Test-only and tooling configuration changes.

## Implementation steps

### Step 1 — Shared Jest base

1. Create `jest.config.base.ts` exporting shared options:
   - `preset: 'ts-jest'`
   - `testEnvironment: 'node'`
   - existing `moduleNameMapper` paths
   - `transform` / `globals` with `isolatedModules: true` (prefer dedicated `tsconfig.jest.json` extending root `tsconfig.json`)
   - `diagnostics: { ignoreCodes: [151002] }` only if isolatedModules alone does not silence warnings

### Step 2 — Split configs

1. Update `jest.unit.config.ts`:

   ```ts
   testMatch: ['**/*.spec.ts'],
   testPathIgnorePatterns: [
     '\\.module\\.spec\\.ts$',
     '<rootDir>/scripts/release/',
   ],
   testTimeout: 10_000,
   ```

   Expected ~17 suites after exclusion (23 − 6 module − 1 release; `bullmq.module.spec.ts` moves to module bucket).

2. Create `jest.module.config.ts`:

   ```ts
   testMatch: ['**/*.module.spec.ts'],
   testTimeout: 30_000,
   ```

   Document `--runInBand` in the npm script for deterministic teardown order.

3. Create `jest.release.config.ts`:

   ```ts
   testMatch: ['<rootDir>/scripts/release/**/*.spec.ts'],
   ```

4. Refactor `jest.integration.config.ts` to spread `jest.config.base.ts` (no change to `*.int-spec.ts` match).

### Step 3 — npm scripts

Add to `package.json`:

```json
"test:unit": "node node_modules/jest/bin/jest.js --config jest.unit.config.ts",
"test:module": "node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand",
"test:release": "node node_modules/jest/bin/jest.js --config jest.release.config.ts",
"test:all": "npm run test:unit && npm run test:module && npm run test:release"
```

Keep `test:int` as-is. Do **not** change `package-lock.json`.

### Step 4 — Fix open handles in module specs

1. **`drizzle.module.spec.ts` (required):** follow `redis.module.spec.ts` pattern:
   - `jest.mock('pg', () => jest.fn().mockImplementation(() => ({ on: jest.fn(), end: jest.fn().mockResolvedValue(undefined), query: jest.fn() })))`
   - assert `PG_POOL` / `DRIZZLE_DB` tokens resolve after `compile()`
   - `await moduleRef.close()` in test body or `afterEach`
2. **Audit** `auth.module.spec.ts`, `mail.module.spec.ts`, `storage.module.spec.ts`, `redis.module.spec.ts`, `bullmq.module.spec.ts`:
   - confirm every `Test.createTestingModule` path calls `moduleRef.close()` (add shared `afterEach` helper only if a file has multiple tests without close — avoid over-abstraction).
3. Run `npm run test:module -- --detectOpenHandles` and fix any reported timers/sockets.

### Step 5 — Binary search procedure (implementer diagnostic)

If open handles remain after Step 4:

1. `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand --detectOpenHandles --testPathPatterns=<file>`
2. Halve suite list until offending spec is isolated.
3. Fix lifecycle in that spec; re-run full `test:module`.

### Step 6 — Documentation / V-14

1. Update `AGENTS.md` verification section:
   - **Fast agent gate:** `npm run test:unit`
   - **Before merge / full check:** `npm run test:unit && npm run test:module && npm run test:release`
   - **Infra specs:** `npm run test:int` (PostgreSQL/Redis required)
2. Update `README.md` scripts table and testing chapter mirroring the above.
3. Update `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § V-14 row and add a short command matrix:

   | Scenario          | Command                                      | Expected                                       |
   | ----------------- | -------------------------------------------- | ---------------------------------------------- |
   | Fast unit gate    | `npm run test:unit`                          | Exit 0, completes in < 30 s warm / < 90 s cold |
   | Module bootstrap  | `npm run test:module -- --detectOpenHandles` | Exit 0, no open-handle warnings                |
   | Release policy    | `npm run test:release`                       | Exit 0                                         |
   | Open-handle audit | `npm run test:module -- --detectOpenHandles` | Jest exits cleanly without `forceExit`         |

## Migration and rollout concerns

- **Agent habits:** contributors/scripts referencing bare `npm run test:unit` for full coverage must adopt `test:all` or explicit module/release commands.
- **No production deploy impact.**
- **Backward compatibility:** `test:unit` name retained but scope shrinks (intentional breaking change to test scope only — document clearly).
- **CI:** if CI is added later, wire `test:all` + optional `test:int` with services.

## Targeted verification

| Step | Command                                                                             | Expected                                            |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| T1   | `npm run test:unit`                                                                 | Exit 0; ~17 suites; no `*.module.spec.ts` in output |
| T2   | `npm run test:module -- --detectOpenHandles`                                        | Exit 0; 6 suites; no open-handle warnings           |
| T3   | `npm run test:release`                                                              | Exit 0; 9 tests in `release-policy.spec.ts`         |
| T4   | `npm run test:unit -- --runInBand`                                                  | Exit 0; completes well under 240 s                  |
| T5   | `node node_modules/jest/bin/jest.js --config jest.unit.config.ts --listTests`       | List excludes module + release paths                |
| T6   | `npm run test:module -- --testPathPatterns=drizzle.module.spec --detectOpenHandles` | Exit 0; no real TCP dependency                      |

## Full verification

| Command                | Expected                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run test:unit`    | Exit 0                                                            |
| `npm run test:module`  | Exit 0                                                            |
| `npm run test:release` | Exit 0                                                            |
| `npm run test:all`     | Exit 0 (chains unit + module + release)                           |
| `npm run lint`         | Exit 0 (config/tsconfig JSON files only — no new lint violations) |
| `npm run build`        | Exit 0 (tsconfig.jest.json must not break Nest builds)            |

`npm run test:int` — run only when PostgreSQL and Redis are available; not required for P3-04 acceptance.

## Acceptance criteria

Mapped to backlog § P3-04:

- [ ] **AC-1:** `npm run test:unit -- --runInBand` completes reliably (exit 0) within agent tool timeouts on a clean `npm ci` workspace.
- [ ] **AC-2:** Integration/bootstrap-style specs (`*.module.spec.ts`) run via a **separate** `test:module` command; `test:unit` no longer includes them.
- [ ] **AC-3:** `npm run test:module -- --detectOpenHandles` exits without dangling Redis/BullMQ/PostgreSQL/Nest handle warnings (no permanent `forceExit`).
- [ ] **AC-4:** `scripts/release/release-policy.spec.ts` runs via `test:release`, not `test:unit`.
- [ ] **AC-5:** `AGENTS.md`, `README.md`, and V-14 document the fast local verification loop (`test:unit` + when to run `test:module` / `test:release` / `test:int`).
- [ ] **AC-6:** ts-jest TS151002 warnings eliminated or reduced via `isolatedModules` Jest config (not by disabling typechecking globally).

## Risks

| Risk                                                                                     | Mitigation                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `test:unit` scope shrink surprises contributors                                          | Document in README + AGENTS; provide `test:all`                                                                    |
| Mocking `pg` in drizzle module spec reduces integration confidence                       | Keep real pool behavior in `drizzle-outbox-processor.int-spec.ts`                                                  |
| Windows npm Jest crash persists for some invocations                                     | Use `node node_modules/jest/bin/jest.js` in scripts; document in V-14                                              |
| `bullmq.module.spec.ts` has no `Test.createTestingModule` but matches `*.module.spec.ts` | Acceptable in module bucket (fast); or add to `testPathIgnorePatterns` in module config if separation is confusing |
| Cold compile still slow on first run                                                     | ts-jest `isolatedModules` reduces overhead; set realistic V-14 timing thresholds                                   |

## Rollback strategy

1. Revert `jest.unit.config.ts`, delete new jest config files, restore original `package.json` scripts.
2. Revert spec and documentation changes.
3. No database migrations or runtime flags to roll back.

## Open questions requiring human decision

1. **`test:all` vs CI naming:** Should `test:all` also chain `test:int`, or remain unit+module+release only (recommended: **exclude** `test:int` because it needs infra)?
2. **Windows npm script:** Approve switching all Jest npm scripts to `node node_modules/jest/bin/jest.js` (recommended based on P2-08/P2-11 evidence), or keep `jest` CLI and document workaround only?
3. **V-14 timing SLA:** Accept planner proposal (< 30 s warm / < 90 s cold for `test:unit`), or define stricter CI numbers?
4. **`bullmq.module.spec.ts` placement:** Keep in `test:module` via `*.module.spec.ts` glob, or rename/move to pure unit bucket?
