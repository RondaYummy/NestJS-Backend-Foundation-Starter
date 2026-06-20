# P0-02 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P0-02-outbox-lease-heartbeat.md` (`status: approved`)

## Changed files

| Path                                                                     | Change                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `libs/contracts/src/outbox/outbox-processor.options.ts`                  | Added `lockHeartbeatIntervalMs`, `handlerTimeoutMs`                     |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | Env fields, computed defaults, cross-field validation, helper functions |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | Computed default heartbeat/timeout from `lockTtlMs`                     |
| `libs/infrastructure/src/config/env.schema.ts`                           | Mirrored OUTBOX env vars and validation                                 |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`         | Wired new env fields into `mapOutboxEnvToOptions()`                     |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`             | `renewEventLease()`, `publishEventWithLease()` with heartbeat + timeout |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`        | Unit tests for renewal, heartbeat, ownership loss                       |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts`    | **Created** — V-04 integration scenario                                 |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | Validation cases for new options                                        |
| `.env.example`                                                           | Documented new env vars                                                 |
| `README.md`                                                              | Updated §5.13 Outbox tuning (heartbeat, timeout, at-least-once)         |

## Completed steps

1. Extended `OutboxProcessorOptions` contract and env mapping with computed defaults.
2. Implemented `renewEventLease()` conditional DB update on `id`, `status = processing`, `locked_by`.
3. Wrapped publication in heartbeat interval + optional handler timeout via `publishEventWithLease()`.
4. Preserved existing `claimPendingBatch`, `markProcessed`, `markFailed` semantics.
5. Added unit and integration tests.
6. Updated `.env.example` and README Outbox section.

## Deviations

None. Integration test sets `handlerTimeoutMs: 10_000` (above the 5 s slow route) so the V-04 scenario exercises lease renewal rather than handler timeout — consistent with plan intent and open question #1 (default timeout = `lockTtlMs`).

## Commands executed

```bash
npm ci
npm run test:unit -- libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts
npm run test:unit -- libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts
npm run test:int -- libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts
npm run build
npm run lint
npm run test:unit
npm run test:int
```

## Command results

| Command                                  | Result                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| `npm ci`                                 | Exit 0                                                         |
| Targeted unit tests (processor + schema) | Exit 0 — 6 + 8 tests passed                                    |
| Targeted integration test                | Exit 0 — skipped (PostgreSQL unavailable locally)              |
| `npm run build`                          | Exit 0                                                         |
| `npm run lint`                           | Exit 0 (after removing unnecessary type assertion in int-spec) |
| `npm run test:unit`                      | Exit 0 — 22 tests passed                                       |
| `npm run test:int`                       | Exit 0 — 2 tests passed (V-03 Redis + V-04 PG skip)            |

## Acceptance criteria self-check

| #   | Criterion                                                      | Status                                                                        |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Worker B cannot reclaim event while A publishes with heartbeat | Implemented; V-04 int-spec asserts single `route()` call (skipped without PG) |
| 2   | `renewEventLease` conditional update                           | Implemented + unit tested                                                     |
| 3   | Heartbeat/timeout configurable via options and env             | Implemented + schema tests                                                    |
| 4   | Ownership loss not reported as success                         | Throws before `markProcessed`; existing audit path preserved                  |
| 5   | V-04 integration scenario                                      | Test added; runtime pass requires PostgreSQL                                  |
| 6   | `.env.example` and README updated                              | Done                                                                          |
| 7   | No `IOutboxProcessor` or schema changes                        | Confirmed                                                                     |

## Remaining risks

- Residual at-least-once window after successful route but before `markProcessed()` (documented, out of scope).
- Handler timeout default equals `lockTtlMs`; slow handlers need explicit `OUTBOX_HANDLER_TIMEOUT_MS` increase.
- Heartbeat adds periodic DB writes under high concurrency (mitigated by default `lockTtlMs / 3` interval).

## Unverified areas

- V-04 integration test did not execute against live PostgreSQL in this environment (`DATABASE_URL` missing/unreachable). Test skips gracefully with warning.
- Worker/Cron bootstrap with new env vars not run (no local PostgreSQL/Redis stack started for this task).
