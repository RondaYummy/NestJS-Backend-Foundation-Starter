# P3-04 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P3-04-isolate-unit-suite-timeout-open-handles.md` (`status: approved`)

## Changed files

| Path                                                              | Change                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `jest.config.base.ts`                                             | **Created** — shared preset, `moduleNameMapper`, ts-jest transform with `tsconfig.jest.json`   |
| `jest.module.config.ts`                                           | **Created** — `*.module.spec.ts`, 30 s timeout                                                 |
| `jest.release.config.ts`                                          | **Created** — `scripts/release/**/*.spec.ts`                                                   |
| `tsconfig.jest.json`                                              | **Created** — extends root tsconfig with `isolatedModules: true`, `rootDir: "."`               |
| `jest.unit.config.ts`                                             | Narrowed selection; excludes module + release paths; 10 s timeout                              |
| `jest.integration.config.ts`                                      | Imports shared base (DRY); unchanged `*.int-spec.ts` match                                     |
| `package.json`                                                    | Added `test:module`, `test:release`, `test:all`; Jest via `node node_modules/jest/bin/jest.js` |
| `libs/infrastructure/src/database/drizzle/drizzle.module.spec.ts` | Mock `pg.Pool` (no real TCP)                                                                   |
| `apps/api/src/composition/auth-application.module.spec.ts`        | Mock `pg.Pool` alongside existing `ioredis` mock                                               |
| `AGENTS.md`                                                       | Documented test suite split and V-14 verification loop                                         |
| `README.md`                                                       | Updated scripts table and testing section                                                      |
| `EXAMPLES.md`                                                     | Added module/release/test:all commands to quick-reference table                                |
| `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`         | Added V-14 command matrix                                                                      |

## Completed steps

1. **Shared Jest base** — `jest.config.base.ts` + `tsconfig.jest.json` with `isolatedModules: true`; ts-jest `diagnostics.ignoreCodes: [151002]` inside transform options.
2. **Split configs** — unit (18 pure specs), module (9 `*.module.spec.ts`), release (`scripts/release/**/*.spec.ts`); integration inherits base.
3. **npm scripts** — `test:module`, `test:release`, `test:all`; Jest invoked through `node node_modules/jest/bin/jest.js`.
4. **Open handles** — `drizzle.module.spec.ts` and `auth-application.module.spec.ts` mock `pg.Pool`; audited remaining module specs — all bootstrap paths already call `moduleRef.close()` (or `init()` + `close()` for CronModule).
5. **Documentation** — AGENTS.md, README.md, EXAMPLES.md, V-14 matrix updated.

## Deviations

| Deviation                                              | Reason                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Module bucket has **9** suites (plan listed 6)         | Branch evolved since plan investigation; all match `*.module.spec.ts` glob (`auth-application`, `cron`, `outbox-processor-options` added). |
| Release suite has **12** tests (plan listed 9)         | Unrelated staged P2-15 changes to `release-policy.spec.ts` on this branch; P3-04 only moved the file to `test:release` bucket.             |
| Jest config imports use `./jest.config.base.ts` suffix | Required for Node16 ESM resolution when Jest loads TypeScript config files.                                                                |
| `tsconfig.jest.json` includes `"rootDir": "."`         | Required to satisfy TS5011 when ts-jest uses dedicated jest tsconfig across monorepo paths.                                                |

No production code, contract, or DI changes.

## Commands executed

| Command                                                                                                                                    | Result                                        | Conclusion                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts`                                                                          | Exit 0 — 18 suites, 119 tests, ~2.2 s         | Pure unit gate passes                              |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand`                                                              | Exit 0 — 18 suites, ~2.3 s                    | AC-1: completes well under 240 s                   |
| `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand --detectOpenHandles`                                        | Exit 0 — 9 suites, 18 tests, ~3.3 s           | AC-3: no open-handle warnings                      |
| `node node_modules/jest/bin/jest.js --config jest.release.config.ts`                                                                       | Exit 0 — 1 suite, 12 tests, ~0.3 s            | AC-4: release policy isolated                      |
| `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand --testPathPatterns=drizzle.module.spec --detectOpenHandles` | Exit 0 — 1 test, ~0.6 s                       | No real TCP dependency                             |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts --listTests`                                                              | Exit 0 — 18 paths                             | Excludes `*.module.spec.ts` and `scripts/release/` |
| `npm run test:unit`                                                                                                                        | Exit 0 — 18 suites, ~2.4 s                    | npm script stable this run                         |
| `npm run test:all`                                                                                                                         | Exit 0 — unit + module + release chain, ~15 s | Full non-infra gate passes                         |
| `npm run lint`                                                                                                                             | Exit 0                                        | No new lint violations                             |
| `npm run build`                                                                                                                            | Exit 0                                        | tsconfig.jest.json does not break Nest builds      |

## Command results

All targeted and full verification commands passed. No TS151002 spam observed during test runs after `isolatedModules` + diagnostics config.

## Acceptance criteria self-check

| ID   | Criterion                                                                   | Status                                    |
| ---- | --------------------------------------------------------------------------- | ----------------------------------------- |
| AC-1 | `npm run test:unit -- --runInBand` completes reliably within agent timeouts | **Pass** — 2.3 s warm run, exit 0         |
| AC-2 | `*.module.spec.ts` run via `test:module`; excluded from `test:unit`         | **Pass** — 9 module / 18 unit suites      |
| AC-3 | `test:module -- --detectOpenHandles` exits without dangling handle warnings | **Pass** — clean exit, no forceExit       |
| AC-4 | `release-policy.spec.ts` runs via `test:release`, not `test:unit`           | **Pass** — absent from unit `--listTests` |
| AC-5 | AGENTS.md, README.md, V-14 document verification loop                       | **Pass**                                  |
| AC-6 | TS151002 eliminated/reduced via isolatedModules Jest config                 | **Pass** — no TS151002 in test output     |

## Remaining risks

- **Intermittent Windows npm crash** (`-1073741819`) was observed once on an early `npm run test:unit` attempt before config fixes; subsequent npm invocations succeeded. Direct `node node_modules/jest/bin/jest.js` remains the stable path documented in V-14.
- **`MODULE_TYPELESS_PACKAGE_JSON` warning** on Jest config load — cosmetic; adding `"type": "module"` to root `package.json` is out of scope and would affect the whole repo.
- **`test:unit` scope shrink** — contributors expecting full coverage from `test:unit` alone must adopt `test:all`; documented in README/AGENTS.

## Unverified areas

- `npm run test:int` — not run (PostgreSQL/Redis availability not confirmed; out of P3-04 acceptance scope per plan).
- Cold `npm ci` timing SLA (< 90 s for `test:unit`) — verified warm runs only; cold compile on CI may differ.
- `npm run test:unit -- --runInBand --detectOpenHandles` with extra Jest flags on Windows — not re-tested after initial intermittent crash; module bucket covers open-handle audit per plan.
