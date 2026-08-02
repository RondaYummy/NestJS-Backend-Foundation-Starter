# P2-16 — Implementation report

## Verdict
implemented

## Approved plan
- Plan: `docs/agent-plans/P2-16-cron-ioredis-mock-bullmq-module-spec.md`
- Frontmatter status: `approved`
- Scope followed: inline-only `jest.mock('ioredis')` fix in `apps/cron/src/cron.module.spec.ts`; no production Cron/BullMQ/Redis changes; no shared helper; sibling specs left unchanged; backlog status untouched.

## Changed files
| Path | Change |
| --- | --- |
| `apps/cron/src/cron.module.spec.ts` | CJS/ESM-interop `ioredis` mock (`{ __esModule: true, default: RedisMock }`) plus BullMQ-required client stubs |
| `docs/agent-reports/P2-16-implementation.md` | This implementation report |

## Completed steps
1. Replaced bare `jest.fn()` module export with `{ __esModule: true, default: RedisMock }`.
2. Expanded mock instance with planned stubs: `on`, `off`, `removeListener`, `status: 'ready'`, `info`, `defineCommand`, `connect`, `quit`, `disconnect`.
3. After first targeted run failed on `emitter.getMaxListeners is not a function`, added `getMaxListeners` / `setMaxListeners` stubs named by the BullMQ stack (plan step 5).
4. Kept existing two tests and `withTestEnv` / `TEST_ENV` unchanged.
5. Ran targeted Cron module-spec, then full `npm run test:module`.
6. Did not edit production Cron/BullMQ/Redis code or sibling module specs.

## Deviations
- Added `getMaxListeners` and `setMaxListeners` beyond the plan’s initial stub list. This matches plan step 5 (“iteratively add only the stub methods named in the stack trace”) after `.default` was fixed and BullMQ’s `increaseMaxListeners` / `decreaseMaxListeners` failed on the shallow EventEmitter surface.

## Commands executed
1. `npm run test:module -- --testPathPattern=cron.module.spec` — rejected by Jest CLI (option renamed).
2. `npm run test:module -- --testPathPatterns=cron.module.spec` (first attempt, before EventEmitter stubs).
3. `npm run test:module -- --testPathPatterns=cron.module.spec` (after `getMaxListeners` / `setMaxListeners`).
4. `npm run test:module`

## Command results
| Command | Exit code | Result |
| --- | --- | --- |
| `npm run test:module -- --testPathPattern=cron.module.spec` | 1 | Jest CLI rejected deprecated `--testPathPattern`; used `--testPathPatterns` instead |
| `npm run test:module -- --testPathPatterns=cron.module.spec` (pre EventEmitter stubs) | 1 | Constructor error gone; failed on `getMaxListeners is not a function` |
| `npm run test:module -- --testPathPatterns=cron.module.spec` (final) | 0 | 1 suite, 2 tests passed |
| `npm run test:module` | 0 | 14 suites, 30 tests passed |

## Acceptance criteria self-check
| ID | Criterion | Result |
| --- | --- | --- |
| AC-01 | `npm run test:module` exits 0 with CronModule suite passing | **pass** — exit 0; Cron suite 2/2 passed within 14/14 suites |
| AC-02 | `ioredis_1.default is not a constructor` no longer appears | **pass** — not present after CJS `.default` export; subsequent failure was EventEmitter surface only |
| AC-03 | Diff limited to test mock (no production Cron/BullMQ/Redis changes) | **pass** — only `apps/cron/src/cron.module.spec.ts` (+ this report) |

## Remaining risks
- Sibling specs (`auth-application.module.spec.ts`, `redis.module.spec.ts`) still use the shallow bare-fn `ioredis` mock. Fine today (Redis-only); a future BullMQ bootstrap in those suites could hit the same CJS/EventEmitter gaps.
- Mock still stubs only the BullMQ paths exercised by Cron compile/init/close; deeper Queue usage in other tests may need more methods.

## Unverified areas
- `npm run build` / `npm run lint` (not required by plan).
- Integration tests / real Redis (`test:int`).
- Independent verification / human acceptance; backlog P2-16 left unresolved by design.
