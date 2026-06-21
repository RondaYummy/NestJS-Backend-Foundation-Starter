---
issue_id: P2-05
status: approved
owner: human-approval-required
---

# P2-05 — Add bounded deadlines to readiness checks

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-05. Додати bounded deadlines до readiness checks**.

Related verification scenario: backlog **V-10** (Readiness returns within configured deadline under dependency hangs).

## Current behavior

1. `HealthService.check()` runs three dependency probes in parallel via `Promise.all([checkPostgres, checkRedis, checkBullMq])`.
2. Each private check wraps the underlying call in `try/catch` and maps failures to `services.<name> = 'error'`.
3. There is **no per-check timeout**. If `db.execute`, `redis.ping`, or `outboxQueue.getJobCounts()` hangs (TCP stall, blocked pool, Redis command queue backlog), the entire `check()` call waits indefinitely.
4. `HealthController.ready()` and `HealthController.check()` both await `health.check()` and throw `ServiceUnavailableException` when any dependency is unhealthy. `HealthController.live()` is synchronous and unaffected.
5. Health endpoints are exposed only on the API entrypoint (`apps/api/src/api.module.ts` and deprecated `InfrastructureModule.forRoot()`). Worker and Cron do not host HTTP health controllers.
6. `@nestjs/terminus` is declared in `package.json` but is **not used** anywhere in the codebase.
7. No unit tests exist for `HealthService` or `HealthController`.
8. No `HEALTH_CHECK_TIMEOUT_MS` (or equivalent) exists in `env.schema.ts`, `.env.example`, or `AppConfigService`.

**Investigation (2026-06-21, branch `main`, clean working tree):** architectural risk confirmed — `libs/infrastructure/src/health/health.service.ts` lines 45–49 still use unbounded `Promise.all` without per-check deadlines. Issue is **not stale**.

## Confirmed root cause

Readiness and aggregate health checks inherit the worst-case latency of hung dependency I/O. Kubernetes/Docker/load-balancer probe timeouts (commonly 3–5 s) can expire while the Node process still holds open HTTP connections, causing probe failure storms and request pile-up on `/health/ready`.

## Dependency/runtime flow

```text
HTTP GET /health/ready | GET /health
  -> HealthController.ready() | HealthController.check()
       -> HealthService.check()
            Promise.all([                    // unbounded — defect
              checkPostgres -> db.execute(sql`select 1`)     [DRIZZLE_DB]
              checkRedis    -> redis.ping()                  [REDIS_CLIENT]
              checkBullMq   -> outboxQueue.getJobCounts(...) [@InjectQueue(QUEUES.OUTBOX)]
            ])
            -> { status, services: { postgres, redis, bullmq } }
       -> ServiceUnavailableException when status !== 'ok' (ready) or status === 'error' (aggregate)

Composition roots:
  apps/api/src/api.module.ts
    HealthModule.register({ imports: [redisModule, drizzleModule, bullMqQueuesModule] })
  libs/infrastructure/src/infrastructure.module.ts (deprecated facade)
    HealthModule.register({ imports: [redisModule, drizzleModule, bullMqQueuesModule] })

Config path (to be added):
  process.env.HEALTH_CHECK_TIMEOUT_MS
    -> env.schema.ts
    -> InfrastructureConfigModule validate mapper
    -> AppConfigService.health().checkTimeoutMs
    -> HealthModule.register({ checkTimeoutMs })
    -> HealthService
```

**Symbols on the hang path:**

| File                                                   | Symbol                                                        | Current behavior                        |
| ------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------- |
| `libs/infrastructure/src/health/health.service.ts`     | `check()`, `checkPostgres()`, `checkRedis()`, `checkBullMq()` | Waits forever on hung I/O               |
| `libs/infrastructure/src/health/health.controller.ts`  | `ready()`, `check()`                                          | Propagates unbounded wait to HTTP layer |
| `libs/infrastructure/src/health/health.module.ts`      | `HealthModule.register()`                                     | No timeout configuration surface        |
| `libs/infrastructure/src/config/env.schema.ts`         | `envSchema`                                                   | No health timeout field                 |
| `libs/infrastructure/src/config/app-config.service.ts` | `ConfigShape`, accessors                                      | No `health()` accessor                  |

## Goal

Ensure `/health/ready` and `/health` return within a configured, typed deadline even when one or more dependencies hang, mapping timed-out checks to `error` status without leaking credentials or connection strings.

## Scope

1. Add typed `HEALTH_CHECK_TIMEOUT_MS` configuration with validation and defaults.
2. Extend `HealthModule.register()` to accept `checkTimeoutMs` (portability contract).
3. Implement a small timeout wrapper for individual health probes (reuse the established `Promise.race` + `clearTimeout` pattern from `DrizzleOutboxProcessor.publishEventWithTimeout()`).
4. Refactor `HealthService.check()` to run probes via `Promise.allSettled` with isolated per-service status mapping.
5. Map timeout the same as dependency failure: `services.<name> = 'error'`, overall `status = 'error'`.
6. Ensure error/timeout paths do **not** log `DATABASE_URL`, Redis password, or other secrets.
7. Wire configuration through both API composition roots (`api.module.ts`, deprecated `infrastructure.module.ts`).
8. Add unit tests covering hang scenarios aligned with **V-10**.
9. Document the new env var in `.env.example`.

## Out of scope

- Migrating to `@nestjs/terminus` indicators (dependency exists but unused; would change module shape and possibly response format).
- Adding HTTP health endpoints to Worker or Cron entrypoints.
- Cancelling underlying DB/Redis/BullMQ I/O after timeout (same limitation documented for Outbox handler timeout in **P2-04**; health checks only need bounded HTTP response time).
- Changing `/health/live` behavior (remains synchronous `{ status: 'ok' }`).
- Changing health response JSON shape (`status` + `services` object).
- README or backlog index updates (unless human requests doc sync after implementation).
- Integration tests requiring live PostgreSQL/Redis/BullMQ hang simulation (unit tests with never-resolving mocks are primary evidence for **V-10**).

## Files to create

| Path                                                               | Responsibility                                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/health/health.module-options.ts`          | Export `HealthModuleOptions` (`checkTimeoutMs: number`) and `HEALTH_MODULE_OPTIONS` injection token.                                                                                                      |
| `libs/infrastructure/src/health/with-health-check-timeout.ts`      | Pure helper: `withHealthCheckTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T>` using `Promise.race`, `clearTimeout` in `finally`, generic timeout error message (no env/credential data). |
| `libs/infrastructure/src/health/with-health-check-timeout.spec.ts` | Unit tests: resolves before deadline, rejects on timeout, clears timer on success.                                                                                                                        |
| `libs/infrastructure/src/health/health.service.spec.ts`            | Unit tests (**V-10**): one hanging dependency → overall response within deadline; all healthy → `ok`; thrown error → `error`; timeout on one service does not block others from completing.               |

## Files to modify

| Path                                                                  | Symbol / responsibility                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/health/health.service.ts`                    | `HealthService` — inject `HealthModuleOptions`; wrap each probe with `withHealthCheckTimeout`; replace `Promise.all` with `Promise.allSettled`; map `rejected`/`timeout` to `'error'` per service; keep existing public `HealthResult` shape. |
| `libs/infrastructure/src/health/health.module.ts`                     | `HealthModuleRegisterOptions`, `HealthModule.register()` — accept `checkTimeoutMs`; register `HEALTH_MODULE_OPTIONS` provider; use factory provider for `HealthService` injecting options.                                                    |
| `libs/infrastructure/src/config/env.schema.ts`                        | Add `HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(3000)`.                                                                                                                                                              |
| `libs/infrastructure/src/config/app-config.service.ts`                | Extend `ConfigShape` with `health: { checkTimeoutMs: number }`; add `health()` accessor.                                                                                                                                                      |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`      | Map `HEALTH_CHECK_TIMEOUT_MS` into `health.checkTimeoutMs` in validate callback.                                                                                                                                                              |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | Add `mapAppConfigToHealthOptions(config): HealthModuleOptions`.                                                                                                                                                                               |
| `apps/api/src/api.module.ts`                                          | Pass `checkTimeoutMs` into `HealthModule.register({ imports, checkTimeoutMs })` via `mapAppConfigToHealthOptions` + `AppConfigService` factory (mirror other module wiring).                                                                  |
| `libs/infrastructure/src/infrastructure.module.ts`                    | Same `HealthModule.register` timeout wiring for deprecated facade parity.                                                                                                                                                                     |
| `.env.example`                                                        | Document `HEALTH_CHECK_TIMEOUT_MS=3000` under a `# Health checks` section.                                                                                                                                                                    |
| `libs/infrastructure/src/config/env.schema.spec.ts`                   | Assert default/validation for `HEALTH_CHECK_TIMEOUT_MS` (positive integer).                                                                                                                                                                   |

## Files to delete

None.

## Contract and DI changes

### New infrastructure-local options (not a Contracts port)

```ts
// libs/infrastructure/src/health/health.module-options.ts
export type HealthModuleOptions = {
  checkTimeoutMs: number;
};

export const HEALTH_MODULE_OPTIONS = Symbol('HEALTH_MODULE_OPTIONS');
```

### Public HTTP response (unchanged)

```json
{
  "status": "ok" | "error",
  "services": {
    "postgres": "ok" | "error",
    "redis": "ok" | "error",
    "bullmq": "ok" | "error"
  }
}
```

Timed-out dependencies appear as `"error"` — indistinguishable from thrown failures at the HTTP layer (acceptable; operators infer hang/outage from probe latency + logs).

### DI wiring

```ts
// HealthModule.register({ imports, checkTimeoutMs })
providers: [
  { provide: HEALTH_MODULE_OPTIONS, useValue: { checkTimeoutMs } },
  {
    provide: HealthService,
    useFactory: (db, redis, queue, options) => new HealthService(db, redis, queue, options),
    inject: [DRIZZLE_DB, REDIS_CLIENT, getQueueToken(QUEUES.OUTBOX), HEALTH_MODULE_OPTIONS],
  },
];
```

### Environment

| Variable                  | Type             | Default | Notes                                                                                                               |
| ------------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `HEALTH_CHECK_TIMEOUT_MS` | positive integer | `3000`  | Per-dependency probe deadline; aligns with `REDIS_CONNECT_TIMEOUT_MS` and Docker healthcheck `timeout: 5s` headroom |

## Implementation steps

1. **Options and token** — Create `health.module-options.ts` with `HealthModuleOptions` and `HEALTH_MODULE_OPTIONS`.
2. **Timeout helper** — Create `with-health-check-timeout.ts` following the `publishEventWithTimeout()` timer lifecycle (`setTimeout` + `clearTimeout` in `finally`). Timeout rejection message: generic string such as `Health check timed out after ${timeoutMs}ms` (no dependency names tied to credentials).
3. **Config pipeline** — Add `HEALTH_CHECK_TIMEOUT_MS` to `env.schema.ts`, map in `infrastructure-config.module.ts`, expose via `AppConfigService.health()`, add `mapAppConfigToHealthOptions()` mapper.
4. **HealthService refactor** — Inject options; extract a private `runCheck(name, operation, services, key)` that:
   - wraps `operation` with `withHealthCheckTimeout(..., this.options.checkTimeoutMs)`;
   - on success leaves default `'ok'`;
   - on any rejection sets `services[key] = 'error'` without logging caught error objects (they may contain driver-specific connection metadata).
   - run three checks via `Promise.allSettled([...])` (checks already mutate `services` in place).
5. **HealthModule DI** — Extend `register()` to require/provide `checkTimeoutMs`; switch `HealthService` to factory provider.
6. **Composition roots** — Update `api.module.ts` and `infrastructure.module.ts` to pass `checkTimeoutMs: mapAppConfigToHealthOptions(config).checkTimeoutMs` (or inline `config.health().checkTimeoutMs`).
7. **Tests** — Add unit specs for timeout helper and `HealthService` hang matrix (**V-10**). Add env schema test for new variable.
8. **`.env.example`** — Document the variable with a short comment about probe/orchestrator alignment.

## Migration and rollout concerns

- **Backward compatible:** new env var has a safe default; existing deployments without the variable behave as if `HEALTH_CHECK_TIMEOUT_MS=3000`.
- **Probe tuning:** operators running Kubernetes probes with `timeoutSeconds: 1` may need to lower the env var or raise probe timeout; document in `.env.example` comment, not code.
- **Deprecated facade:** `InfrastructureModule.forRoot()` consumers get the same behavior once wired — no separate config path.
- **No database migration.**

## Targeted verification

| Command / scenario                                  | Expected result                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run test:unit -- --testPathPattern=health`     | New health unit tests pass; hang scenario completes within `checkTimeoutMs + buffer`. |
| `npm run test:unit -- --testPathPattern=env.schema` | `HEALTH_CHECK_TIMEOUT_MS` default and validation pass.                                |
| `npm run build:api`                                 | Compiles with new DI wiring in `api.module.ts`.                                       |

**V-10 unit scenario (primary evidence):**

```text
Given: HealthService with checkTimeoutMs = 100
  And: mock db.execute returns new Promise(() => {})  // never resolves
  And: mock redis.ping resolves 'PONG'
  And: mock queue.getJobCounts resolves counts
When: await health.check()
Then: completes in < 250ms
  And: result.status === 'error'
  And: result.services.postgres === 'error'
  And: result.services.redis === 'ok'
  And: result.services.bullmq === 'ok'
```

## Full verification

| Command             | Expected result          |
| ------------------- | ------------------------ |
| `npm run build`     | All entrypoints compile. |
| `npm run lint`      | No new lint violations.  |
| `npm run test:unit` | Full unit suite passes.  |

Optional manual runtime check (requires local API + infra):

```text
Command: start API with HEALTH_CHECK_TIMEOUT_MS=500, simulate hung Postgres (e.g. firewall/pause), curl /health/ready
Expected: HTTP 503 within ~500ms, body shows postgres: error
Actual: (record at verification time)
```

## Acceptance criteria

Mapped from backlog **P2-05** and **V-10**:

- [ ] Typed `HEALTH_CHECK_TIMEOUT_MS` exists in env schema with positive-integer validation and documented default.
- [ ] `HealthModule.register()` accepts explicit `checkTimeoutMs` (portability; no `process.env` reads inside `HealthService`).
- [ ] Each dependency probe runs under an individual timeout wrapper.
- [ ] `HealthService.check()` uses `Promise.allSettled` (or equivalent isolated completion) so one hung check does not block others beyond the shared HTTP response window.
- [ ] Timed-out probes map to `services.<name> = 'error'` and overall `status = 'error'`.
- [ ] Timeout/error paths do not log credentials, connection strings, or raw driver error payloads.
- [ ] `/health/ready` and `/health` return within bounded time when a dependency hangs (**V-10** unit evidence).
- [ ] Public health JSON shape remains unchanged.
- [ ] `npm run build`, `npm run lint`, and targeted unit tests pass.

## Risks

| Risk                                                               | Mitigation                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Underlying I/O continues after timeout (orphaned queries/commands) | Accept for health probes; document same limitation as Outbox timeout; probes are lightweight (`select 1`, `PING`, `getJobCounts`). |
| Default 3000 ms exceeds some aggressive probe configs              | Document in `.env.example`; operator tunes env or probe timeout.                                                                   |
| False `error` during slow but healthy cold start                   | Unchanged semantics — slow deps already fail readiness; timeout makes failure explicit and bounded.                                |
| Factory DI regression in `HealthModule`                            | Unit-test module compilation or service instantiation; run `build:api`.                                                            |

## Rollback strategy

1. Revert health module/service changes and config additions.
2. Remove `HEALTH_CHECK_TIMEOUT_MS` from environment (falls back to pre-change unbounded behavior).
3. No data migration rollback required.

## Open questions requiring human decision

1. **Terminus vs custom wrapper:** This plan uses a minimal custom timeout wrapper to preserve the existing response contract and avoid a Terminus migration. Should the project instead adopt `@nestjs/terminus` health indicators (already in dependencies) in a follow-up task?
2. **Default timeout:** Is `3000` ms acceptable as the default, or should it match Docker Compose probe `timeout: 5s` with a lower default (e.g. `2000`) to leave headroom for framework overhead?
3. **Per-endpoint deadlines:** Should `/health` (aggregate) and `/health/ready` share the same per-check timeout, or should readiness use a stricter/shorter deadline? Current plan: same `check()` path for both.
4. **Logging policy:** Should timed-out checks emit a structured warn log with `{ service: 'postgres' \| 'redis' \| 'bullmq', reason: 'timeout' }` (no secrets), or remain silent like current catch blocks? Current plan: silent mapping unless human requests observability.
