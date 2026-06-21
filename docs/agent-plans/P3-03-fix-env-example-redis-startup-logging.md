---
issue_id: P3-03
status: approved
owner: human-approval-required
---

# P3-03 — Fix `.env.example` and Redis startup logging prefix

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P3-03. Виправити `.env.example` і component-specific startup logging** (lines 959–973).

**Severity:** Low  
**Classification:** Documentation mismatch

**Required changes (from backlog):**

- Keep one canonical env key per setting.
- Remove obsolete aliases or document migration.
- Pass component name to startup probe **or** use neutral prefix `[redis-startup]`.

## Current behavior

1. **`.env.example` Outbox section (lines 25–40)** documents canonical keys `OUTBOX_HEARTBEAT_INTERVAL_MS` and `OUTBOX_HANDLER_TIMEOUT_MS`, but also retains commented obsolete aliases:
   - `# OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS=100000` with a misleading default comment (`max(floor(OUTBOX_LOCK_TTL_MS / 3), 1000)`).
   - `# OUTBOX_HANDLER_TIMEOUT_MS=300000` with comment `Optional; default: OUTBOX_LOCK_TTL_MS` — duplicates the active key above and contradicts the implemented default (`0` = disabled).

2. **`.env.example` Redis section (line 13)** comment reads `# Redis startup policy for Worker`, but the four `REDIS_*` startup vars are consumed by all three Redis-dependent entrypoints (API, Worker, Cron) via `getRedisStartupConfig()`.

3. **`assertRedisAvailable()`** in `libs/infrastructure/src/redis/assert-redis-available.ts` logs success and retry failures with hardcoded prefix `[worker-startup]` (lines 74, 85), even when invoked from API or Cron bootstrap.

4. **Canonical runtime config** already uses the correct Outbox env names in `libs/infrastructure/src/config/env.schema.ts` (`OUTBOX_HEARTBEAT_INTERVAL_MS`, `OUTBOX_HANDLER_TIMEOUT_MS`) and `README.md` § Outbox runtime configuration (lines 1121–1132). No code reads `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`.

5. **Entrypoint-specific failure prefixes** already exist separately in each `main.ts` (`[api-startup]`, `[worker-startup]`, `[cron-startup]`) for top-level bootstrap errors; only the shared Redis probe helper is mislabeled.

**Investigation (2026-06-21, current branch):** issue confirmed — not stale. Unrelated in-flight work exists on outbox schema files (P2-11); this plan does not depend on or modify that scope.

## Confirmed root cause

1. **`.env.example` drift:** Leftover commented aliases from the original **P0-02** plan (`OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`) were never removed after implementation settled on `OUTBOX_HEARTBEAT_INTERVAL_MS`. The duplicate commented `OUTBOX_HANDLER_TIMEOUT_MS` line preserves an obsolete default narrative (`OUTBOX_LOCK_TTL_MS`) that no longer matches `env.schema.ts` (`default(0)`).

2. **Misleading Redis comment:** `.env.example` was written when Redis startup policy was described as Worker-only; `assertRedisAvailable()` was later wired into API and Cron `main.ts` without updating the example comment.

3. **Copy-paste log prefix:** `assertRedisAvailable()` was authored with Worker-oriented `[worker-startup]` strings and never generalized when reused across entrypoints.

**Historical note:** `docs/agent-plans/P0-02-outbox-lease-heartbeat.md` proposed `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`; shipped code uses `OUTBOX_HEARTBEAT_INTERVAL_MS` mapped in `mapOutboxEnvToOptions()` (`outbox-processor.options.schema.ts`). Treat `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` as a never-implemented alias, not a supported migration path.

## Dependency/runtime flow

```text
process.env
  -> .env.example (operator reference; not parsed at runtime)

API / Worker / Cron bootstrap (before NestFactory.create):
  apps/api/src/main.ts
  apps/worker/src/main.ts
  apps/cron/src/main.ts
    -> getRedisStartupConfig()          [redis-startup-config.ts]
         reads REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB,
                REDIS_STARTUP_MAX_ATTEMPTS, REDIS_STARTUP_RETRY_DELAY_MS,
                REDIS_CONNECT_TIMEOUT_MS
    -> assertRedisAvailable(options)    [assert-redis-available.ts]
         console.info/error with prefix [worker-startup]  <-- defect
    -> NestFactory.create(...)

Outbox env (separate path; already canonical):
  env.schema.ts OUTBOX_HEARTBEAT_INTERVAL_MS, OUTBOX_HANDLER_TIMEOUT_MS
    -> InfrastructureConfigModule
    -> AppConfigService.outbox()
    -> OutboxProcessorModule.forRootAsync()
    -> mapOutboxEnvToOptions()
```

**Symbols on the defect path:**

| File                                                      | Symbol                    | Current behavior                                      |
| --------------------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| `.env.example`                                            | Outbox block lines 32–35  | Commented obsolete/duplicate keys                     |
| `.env.example`                                            | Line 13 comment           | Says "Worker" only                                    |
| `libs/infrastructure/src/redis/assert-redis-available.ts` | `assertRedisAvailable()`  | Logs `[worker-startup]`                               |
| `apps/api/src/main.ts`                                    | `bootstrap()`             | Calls `assertRedisAvailable(getRedisStartupConfig())` |
| `apps/worker/src/main.ts`                                 | `bootstrap()`             | Same                                                  |
| `apps/cron/src/main.ts`                                   | `bootstrap()`             | Same                                                  |
| `libs/infrastructure/src/redis/redis-startup-config.ts`   | `getRedisStartupConfig()` | Shared env parsing; no logging                        |

## Goal

Align operator-facing env documentation and startup logs with actual runtime behavior: one canonical Outbox env key per setting, accurate Redis startup scope comment, and neutral `[redis-startup]` log prefix in the shared Redis probe helper.

## Scope

1. Clean `.env.example` Outbox section — remove commented obsolete aliases and duplicate handler-timeout line; keep canonical keys and inline comments consistent with `env.schema.ts` and `README.md`.
2. Fix `.env.example` Redis startup comment to reflect API, Worker, and Cron usage.
3. Replace `[worker-startup]` with `[redis-startup]` in `assertRedisAvailable()` log lines (success + retry failure).
4. Verify no remaining references to `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` in operator-facing templates (`.env.example` only; historical plan docs unchanged).

## Out of scope

- Changing `env.schema.ts`, `AppConfigService`, or Outbox processor options (already canonical).
- Updating `README.md` Outbox section (already uses `OUTBOX_HEARTBEAT_INTERVAL_MS` / `OUTBOX_HANDLER_TIMEOUT_MS=0`).
- Rewriting historical `docs/agent-plans/P0-02-outbox-lease-heartbeat.md` (documents original naming proposal).
- Adding a `componentName` parameter to `assertRedisAvailable()` or threading prefixes through three `main.ts` call sites (neutral prefix is sufficient and simpler).
- Adding README documentation for Redis startup env vars (not requested by backlog; `.env.example` comment fix only).
- New unit tests for `assert-redis-available.ts` (log-prefix change is low risk; verification via grep and optional manual bootstrap log inspection).
- Backlog index or issue status updates (human acceptance workflow).

## Files to create

None.

## Files to modify

| Path                                                      | Symbol / responsibility                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.env.example`                                            | Line 13 — change comment from `# Redis startup policy for Worker` to `# Redis startup policy (API, Worker, Cron)` (or equivalent neutral wording).                                                                                                                                                                                                                                                           |
| `.env.example`                                            | Lines 25–40 Outbox block — remove lines 32–35 (commented `# OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` and duplicate `# OUTBOX_HANDLER_TIMEOUT_MS`). Retain active `OUTBOX_HEARTBEAT_INTERVAL_MS=100000` and `OUTBOX_HANDLER_TIMEOUT_MS=0` with existing inline comment on line 30–31. Optionally tighten heartbeat comment to match README (`at most half of lockTtlMs`; schema validates `<= floor(lockTtlMs/2)`). |
| `libs/infrastructure/src/redis/assert-redis-available.ts` | `assertRedisAvailable()` — replace `[worker-startup]` with `[redis-startup]` in `console.info` (line 74) and `console.error` (line 85). Do not change thrown `Error` message text (remains component-neutral).                                                                                                                                                                                               |

## Files to delete

None.

## Contract and DI changes

None.

- `RedisStartupCheckOptions` type unchanged.
- `assertRedisAvailable()` signature unchanged.
- No Nest DI tokens, module providers, or composition-root registration changes.
- No env schema or public HTTP/API contract changes.

## Implementation steps

1. **Edit `.env.example` Redis comment (line 13)**
   - Replace Worker-only wording with text that names all three entrypoints that call `assertRedisAvailable()` before bootstrap.

2. **Edit `.env.example` Outbox block (lines 32–35)**
   - Delete commented `# OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS=100000` and its default comment.
   - Delete commented duplicate `# OUTBOX_HANDLER_TIMEOUT_MS=300000` and its obsolete default comment.
   - Confirm remaining active keys match `env.schema.ts` defaults:
     - `OUTBOX_HEARTBEAT_INTERVAL_MS=100000`
     - `OUTBOX_HANDLER_TIMEOUT_MS=0` (with existing "0 = disabled" comment)

3. **Edit `assert-redis-available.ts` log prefix**
   - In `assertRedisAvailable()`, change both log template strings from `[worker-startup]` to `[redis-startup]`.
   - Leave `throw new Error('Redis is unavailable after ...')` unchanged (callers wrap with their own `[api-startup]` / `[worker-startup]` / `[cron-startup]` prefixes).

4. **Repo-wide sanity grep (implementer)**
   - Confirm zero runtime references to `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS`.
   - Confirm zero remaining `[worker-startup]` strings inside `assert-redis-available.ts`.
   - Confirm entrypoint `main.ts` files still use their own component prefixes for top-level failures.

## Migration and rollout concerns

- **Outbox env aliases:** `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` was never read by runtime code. Removing commented lines from `.env.example` is documentation-only; no operator migration required unless a team manually copied the obsolete commented name into a live `.env` (they should rename to `OUTBOX_HEARTBEAT_INTERVAL_MS`).
- **Handler timeout default narrative:** The removed commented line suggested default `OUTBOX_LOCK_TTL_MS`; implemented default is `0` (disabled). Teams relying on the obsolete comment should consult `README.md` § Outbox tuning (`handlerTimeoutMs` default `0`).
- **Log aggregation:** Operators filtering logs by `[worker-startup]` for Redis probe lines must switch to `[redis-startup]`. Top-level Worker bootstrap errors still use `[worker-startup]` in `apps/worker/src/main.ts`.
- **No redeploy schema or config migration** required beyond pulling updated `.env.example` as reference.

## Targeted verification

| Command / check                                                                                                                    | Expected result                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `rg "OUTBOX_LOCK_HEARTBEAT" .env.example`                                                                                          | No matches                                                                 |
| `rg "\[worker-startup\]" libs/infrastructure/src/redis/assert-redis-available.ts`                                                  | No matches                                                                 |
| `rg "\[redis-startup\]" libs/infrastructure/src/redis/assert-redis-available.ts`                                                   | Two matches (info + error)                                                 |
| `rg "OUTBOX_HEARTBEAT_INTERVAL_MS\|OUTBOX_HANDLER_TIMEOUT_MS" .env.example README.md libs/infrastructure/src/config/env.schema.ts` | Consistent canonical names                                                 |
| Manual read of `.env.example` lines 13–40                                                                                          | Redis comment covers all entrypoints; no duplicate/obsolete Outbox aliases |

## Full verification

Infrastructure module is touched (`libs/infrastructure/src/redis/`). Run:

```bash
npm run build
npm run lint
```

Optional bootstrap log check (requires local Redis or intentional Redis-down scenario):

```bash
# With Redis up — expect [redis-startup] Redis is available ...
npm run start:api
# Repeat or spot-check worker/cron if desired
```

Record: command, result, conclusion (per `AGENTS.md` verification discipline).

## Acceptance criteria

Mapped to backlog **P3-03** requirements:

| Criterion                                                  | Verification                                                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| One canonical env key per Outbox setting in `.env.example` | Only `OUTBOX_HEARTBEAT_INTERVAL_MS` and `OUTBOX_HANDLER_TIMEOUT_MS` remain; obsolete `OUTBOX_LOCK_HEARTBEAT_INTERVAL_MS` comment removed |
| Obsolete aliases removed or migration documented           | Aliases removed from `.env.example`; migration note in this plan (rename to `OUTBOX_HEARTBEAT_INTERVAL_MS` if copied into live env)      |
| Redis startup logs use correct/neutral prefix              | `assertRedisAvailable()` emits `[redis-startup]`, not `[worker-startup]`                                                                 |
| `.env.example` Redis comment not Worker-only               | Comment names API, Worker, Cron (or equivalent)                                                                                          |
| No unintended runtime/config changes                       | `env.schema.ts`, DI, and entrypoint call signatures unchanged                                                                            |
| Build and lint pass                                        | `npm run build` and `npm run lint` succeed                                                                                               |

## Risks

- **Low — log query breakage:** Dashboards/alerts keyed on `[worker-startup]` for Redis probe lines need updating to `[redis-startup]`.
- **Low — operator confusion if live `.env` used obsolete alias:** Unlikely (alias never implemented); document rename in rollout notes above.
- **None — functional behavior:** Probe retry logic, env parsing, and Nest bootstrap order unchanged.

## Rollback strategy

Revert the two modified files (`.env.example`, `assert-redis-available.ts`). No migrations, feature flags, or DI registrations to unwind.

## Open questions requiring human decision

1. **Optional inline comment on `OUTBOX_HEARTBEAT_INTERVAL_MS` in `.env.example`:** Should the implementer add a one-line note that default must be `<= floor(OUTBOX_LOCK_TTL_MS / 2)` (matching `env.schema.ts` superRefine), or keep the section minimal now that obsolete comments are removed?
2. **README Redis startup section:** Backlog does not require it. Should a follow-up doc task add `REDIS_STARTUP_*` vars to `README.md`, or is `.env.example` comment correction sufficient?
3. **Unit test for log prefix:** Approve skipping new tests for this low-severity logging fix, or require a small `assert-redis-available.spec.ts` with mocked `console.info`/`console.error`?
