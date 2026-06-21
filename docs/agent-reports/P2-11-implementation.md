# P2-11 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-11-restore-non-formatting-lint-gate.md` (`status: approved`)

## Changed files

| File                                                                     | Change                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Introduced `defaultLockTtlMs`; wired `computeLockHeartbeatIntervalMs(defaultLockTtlMs)` for heartbeat default; kept `handlerTimeoutMs: 0` |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Removed dead `computeHandlerTimeoutMs()` export                                                                                           |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Removed `computeHandlerTimeoutMs` tests; added `maps env defaults with heartbeat derived from lock ttl` asserting `handlerTimeoutMs: 0`   |

## Completed steps

1. **`outbox-processor.defaults.ts`** — Imported `computeLockHeartbeatIntervalMs`; added `defaultLockTtlMs = 5 * 60 * 1000`; set `lockTtlMs: defaultLockTtlMs` and `heartbeatIntervalMs: computeLockHeartbeatIntervalMs(defaultLockTtlMs)`; left `handlerTimeoutMs: 0`.
2. **`outbox-processor.options.schema.ts`** — Deleted unused `computeHandlerTimeoutMs()` (no production consumer; README/schema default is `0`).
3. **`outbox-processor.options.schema.spec.ts`** — Dropped `computeHandlerTimeoutMs` import and describe block; added test asserting heartbeat alignment with `computeLockHeartbeatIntervalMs(300_000)` and `handlerTimeoutMs: 0`.
4. **Verification** — Ran lint, build, and outbox options unit tests (see below).

## Deviations

**Baseline already partially green before this change.** P2-08 had removed duplicate env-path dead code and unused imports from `outbox-processor.defaults.ts`, so `npm run lint` already exited 0 on the starting branch. The unused `lockTtlMs` local described in the plan was also absent from `mapOutboxEnvToOptions()` (removed during P2-08). This implementation follows the approved P2-11 plan: wire intended helpers in defaults, remove dead `computeHandlerTimeoutMs`, and align tests with documented `handlerTimeoutMs: 0` behavior.

## Commands executed

| Command                                                                                                                                              | Purpose                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `npm run lint`                                                                                                                                       | Full non-formatting lint gate |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts --runInBand` | Outbox options unit tests     |
| `npm run build`                                                                                                                                      | Shared infrastructure build   |

## Command results

| Command                                                                                      | Result                  | Conclusion                                          |
| -------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------- |
| `npm run lint`                                                                               | Exit 0                  | Lint gate passes with zero errors and zero warnings |
| `node node_modules/jest/bin/jest.js ... outbox-processor.options.schema.spec.ts --runInBand` | Exit 0 — 4 tests passed | Outbox option tests green                           |
| `npm run build`                                                                              | Exit 0                  | All entrypoints build successfully                  |

**Note:** `npm run test:unit -- --testPathPatterns=outbox-processor.options` and `npx jest ...` exited with Windows code `-1073741819` (process crash) in this environment. The same spec file passed when invoked via `node node_modules/jest/bin/jest.js` directly.

## Acceptance criteria self-check

| Criterion                                                                                                  | Status                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` exits 0 with no errors or warnings                                                          | Met                                                                                                                                                                     |
| All four backlog-reported unused symbols resolved without `_`-prefix suppression                           | Met — `defaultLockTtlMs` and `computeLockHeartbeatIntervalMs` wired in defaults; `computeHandlerTimeoutMs` removed; unused `lockTtlMs` local was already absent (P2-08) |
| `defaultLockTtlMs` and `computeLockHeartbeatIntervalMs` used in `OUTBOX_PROCESSOR_DEFAULT_OPTIONS`         | Met                                                                                                                                                                     |
| `computeHandlerTimeoutMs` and unused `lockTtlMs` local removed                                             | Met                                                                                                                                                                     |
| `outbox-processor.options.schema.spec.ts` passes and reflects `handlerTimeoutMs: 0` default                | Met                                                                                                                                                                     |
| No changes outside the three listed files                                                                  | Met                                                                                                                                                                     |
| Default runtime values unchanged: `lockTtlMs=300_000`, `heartbeatIntervalMs=100_000`, `handlerTimeoutMs=0` | Met — numerically identical; heartbeat now derived via helper                                                                                                           |

## Remaining risks

| Risk                              | Notes                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-08 overlap                     | If P2-08 is merged/rebased after this change, minor conflict possible in the same outbox files; re-run lint after merge                        |
| `computeHandlerTimeoutMs` removal | If product later wants default timeout = `lockTtlMs`, a behavior change and plan revision would be required (documented open question in plan) |

## Unverified areas

- Full `npm run test:unit` suite — not executed (Jest/npm wrapper crashed in this environment; targeted outbox spec passed via direct node invocation)
- Runtime bootstrap smoke — not required by plan; numeric defaults unchanged
