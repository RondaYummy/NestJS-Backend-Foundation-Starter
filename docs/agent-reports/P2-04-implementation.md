# P2-04 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-04-outbox-timeout-handler-completion-guard.md` (`status: approved`)

## Changed files

| Path                                                                  | Change                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`          | Refactored `publishEventWithTimeout()` to flag timeout without abandoning handler; await handler settlement before throwing       |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`     | Added unit tests for deferred `markFailed`, success-within-timeout, post-timeout non-process, and `handlerTimeoutMs=0` regression |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | Added V-09 integration test: no reclaim while timed-out handler still running                                                     |
| `README.md`                                                           | Updated §5.13 completion-guard timeout semantics and at-least-once wording                                                        |
| `.env.example`                                                        | Comment under `OUTBOX_HANDLER_TIMEOUT_MS` describing settlement guard                                                             |

## Completed steps

1. **Timeout guard in `publishEventWithTimeout()`** — Start single `publishPromise`; when `handlerTimeoutMs > 0`, race against a non-rejecting timeout side that sets `handlerTimedOut` and logs `warn`. If timeout wins, `await publishPromise` to settlement (swallowing late rejection), then throw timeout error. Success path unchanged when handler completes within budget.
2. **`processPending()` lifecycle** — No structural change; `catch` → `markFailed()` and `finally` → clear heartbeat now run only after handler settlement on the timeout path.
3. **Unit tests** — Cases A/B/C plus regression for disabled timeout; all pass with fake timers.
4. **Integration test V-09** — Processor B cannot reclaim at 2.5 s while Processor A handler (5 s) is still running after 2 s timeout; `routeCount === 1`, row not processed, lock cleared after completion.
5. **Documentation** — README and `.env.example` updated per plan.

## Deviations

None. Timeout error takes precedence over late handler rejection per plan default (open question #1).

## Commands executed

| Command                                                                                                                                                                                                                      | Result                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit -- drizzle-outbox-processor.spec.ts`                                                                                                                                                                      | Pass (9 tests)                                                                                                                              |
| `npm run test:int -- drizzle-outbox-processor.int-spec.ts`                                                                                                                                                                   | Pass (2 tests; PostgreSQL available)                                                                                                        |
| `npm run build`                                                                                                                                                                                                              | Pass                                                                                                                                        |
| `npx eslint libs/infrastructure/src/outbox/drizzle-outbox-processor.ts libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts --max-warnings=0` | Pass                                                                                                                                        |
| `npm run lint`                                                                                                                                                                                                               | Fail — pre-existing errors in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (P2-11 scope, not modified by P2-04)  |
| `npm run test:unit`                                                                                                                                                                                                          | Fail — 1 pre-existing failure in `outbox-processor.options.schema.spec.ts` (expects `handlerTimeoutMs: 300_000`, receives `0`; P2-11 scope) |
| `npm run test:int`                                                                                                                                                                                                           | Fail — 1 pre-existing failure in `run-migrations.int-spec.ts` (parallel migration V-06; unrelated to P2-04)                                 |

## Command results

- **P2-04 targeted tests:** all pass with runtime evidence.
- **Build:** all entrypoints compile.
- **P2-04 changed files lint:** clean.
- **Full lint / full test suites:** blocked by pre-existing failures outside P2-04 diff; not introduced by this change.

## Acceptance criteria self-check

| Criterion                                                                           | Status                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------- |
| Slow `route()` exceeding timeout does not release lock until settlement             | Met — unit + int tests                 |
| Second worker cannot reclaim while first handler still running after timeout (V-09) | Met — int test                         |
| `route()` invoked at most once concurrently per timeout cycle                       | Met — `routeCount === 1` in V-09       |
| Handler within timeout → `markProcessed()`                                          | Met — unit test                        |
| Handler exceeding timeout → failed/retried, never processed even if later resolves  | Met — unit test                        |
| `handlerTimeoutMs = 0` unchanged                                                    | Met — regression unit test             |
| README documents completion-guard semantics                                         | Met                                    |
| No contract changes to `IOutboxProcessor`, router, or handlers                      | Met                                    |
| `npm run build` passes                                                              | Met                                    |
| `npm run lint` passes (full repo)                                                   | Not met — pre-existing P2-11 lint debt |

## Remaining risks

- Handlers that never settle still hold the lease indefinitely (pre-existing; cooperative `AbortSignal` deferred per plan).
- Timed-out events stay locked longer until handler completes — intended trade-off; operators should tune `lockTtlMs` / disable timeout if needed.
- Sequential retry after timeout may still duplicate side effects (at-least-once; acceptable per backlog).

## Unverified areas

- Full-repo `npm run lint` and `npm run test:unit` / `npm run test:int` green status (blocked by unrelated pre-existing failures).
- Bootstrap of Worker/Cron entrypoints not re-run; outbox change is localized to processor adapter with no DI wiring changes.
