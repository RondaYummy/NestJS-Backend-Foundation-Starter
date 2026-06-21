# P3-03 — Independent verification

## Verdict

**approved**

## Scope checked

Verified against:

- Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-03 (lines 959–973)
- Approved plan: `docs/agent-plans/P3-03-fix-env-example-redis-startup-logging.md` (`status: approved`)
- Implementation report: `docs/agent-reports/P3-03-implementation.md`
- Actual diff: `git diff HEAD -- .env.example libs/infrastructure/src/redis/assert-redis-available.ts`

**Implementation scope:** exactly two files, +3 / −7 lines — matches the approved plan. No contract, DI, env schema, or entrypoint signature changes.

**Working tree note:** P3-03 changes are staged alongside unrelated P3-02 artifacts (`README.md`, P3-02 reports). Those are outside P3-03 scope and were not evaluated as part of this verification.

## Root-cause assessment

The original defects were documentation drift and a copy-paste log prefix in a shared helper:

1. **`.env.example` Outbox aliases** — commented `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` and duplicate `OUTBOX_HANDLER_TIMEOUT_MS` with obsolete default narratives. Removed; canonical keys `OUTBOX_HEARTBEAT_INTERVAL_MS=100000` and `OUTBOX_HANDLER_TIMEOUT_MS=0` remain with the existing inline comment.
2. **Redis startup comment** — updated from Worker-only to `# Redis startup policy (API, Worker, Cron)`, matching actual usage in `apps/api`, `apps/worker`, and `apps/cron` `main.ts`.
3. **Log prefix** — `assertRedisAvailable()` now emits `[redis-startup]` on success and retry failure; thrown `Error` text remains component-neutral (callers retain `[api-startup]` / `[worker-startup]` / `[cron-startup]` for top-level bootstrap failures).

The fix addresses root cause rather than suppressing symptoms. No functional probe logic, env parsing, or bootstrap order was altered.

## Acceptance criteria matrix

| Criterion                                                  | Result     | Evidence                                                                                                                                |
| ---------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| One canonical env key per Outbox setting in `.env.example` | **passed** | Only `OUTBOX_HEARTBEAT_INTERVAL_MS` and `OUTBOX_HANDLER_TIMEOUT_MS` active; obsolete alias comments removed                             |
| Obsolete aliases removed or migration documented           | **passed** | Aliases removed from `.env.example`; migration note in approved plan                                                                    |
| Redis startup logs use correct/neutral prefix              | **passed** | `[redis-startup]` at lines 74 and 85 in `assert-redis-available.ts`; zero `[worker-startup]` in that file                               |
| `.env.example` Redis comment not Worker-only               | **passed** | Line 13: `# Redis startup policy (API, Worker, Cron)`                                                                                   |
| No unintended runtime/config changes                       | **passed** | `env.schema.ts` unchanged; `assertRedisAvailable()` signature and `RedisStartupCheckOptions` unchanged; entrypoint call sites unchanged |
| Build and lint pass                                        | **passed** | Independent `npm run build` and `npm run lint` exit 0                                                                                   |

## Dependency and DI verification

```text
API / Worker / Cron main.ts
  -> getRedisStartupConfig()     [redis-startup-config.ts — unchanged]
  -> assertRedisAvailable()      [assert-redis-available.ts — log prefix only]
  -> NestFactory.create(...)
```

- No Nest DI tokens, module providers, or composition-root registration changes.
- Entrypoint-specific failure prefixes preserved in `apps/api/src/main.ts` (`[api-startup]`), `apps/worker/src/main.ts` (`[worker-startup]`), `apps/cron/src/main.ts` (`[cron-startup]`).
- `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` has zero matches in `.env.example` and zero runtime TypeScript references (historical plan docs only).

## Commands executed

| Command                                                                                 | Result                               | Conclusion                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `rg "OUTBOX_LOCK_HEARTBEAT" .env.example`                                               | No matches                           | Obsolete alias removed from operator template                             |
| `rg "\[worker-startup\]" libs/infrastructure/src/redis/assert-redis-available.ts`       | No matches                           | Mislabeled prefix removed from shared probe                               |
| `rg "\[redis-startup\]" libs/infrastructure/src/redis/assert-redis-available.ts`        | 2 matches (lines 74, 85)             | Neutral prefix applied to info + error logs                               |
| `rg "assertRedisAvailable\|\[api-startup\]\|\[cron-startup\]" apps/`                    | Matches in api/worker/cron `main.ts` | Shared probe wired to all three entrypoints; component prefixes preserved |
| `npm run build`                                                                         | Exit 0                               | All four entrypoints compile                                              |
| `npm run lint`                                                                          | Exit 0                               | Full-repo lint gate passes                                                |
| `git diff HEAD -- .env.example libs/infrastructure/src/redis/assert-redis-available.ts` | 2 files, +3 / −7 lines               | Scope limited to approved files                                           |

## Findings

No blocking or non-blocking defects found. Implementation matches the approved plan with no documented deviations.

## Documentation alignment

- `.env.example` Outbox keys align with `libs/infrastructure/src/config/env.schema.ts` (`OUTBOX_HEARTBEAT_INTERVAL_MS` default `100_000`, `OUTBOX_HANDLER_TIMEOUT_MS` default `0`).
- README Outbox section (already canonical per plan) was not modified by P3-03 and remains consistent with the cleaned `.env.example`.

## Remaining risks

1. **Log query breakage (low)** — operators filtering Redis probe lines by `[worker-startup]` must switch to `[redis-startup]`; top-level Worker bootstrap errors still use `[worker-startup]` in `apps/worker/src/main.ts`.
2. **Live `.env` with obsolete alias (low)** — if an operator copied `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` from old `.env.example`, they should rename to `OUTBOX_HEARTBEAT_INTERVAL_MS` (alias was never read by runtime).

## Unverified areas

- Optional bootstrap log inspection (`npm run start:api` / worker / cron with Redis up or down) — not executed. Not required for acceptance; the prefix change is static and verified by grep. Infrastructure unavailability would not indicate a project defect for this documentation/logging fix.
