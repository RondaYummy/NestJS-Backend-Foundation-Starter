# P2-05 — Independent verification

## Verdict

**approved**

## Scope checked

- **Issue:** P2-05 — Add bounded deadlines to readiness/health checks (architectural risk: unbounded `Promise.all` on dependency probes).
- **Diff scope:** 10 modified files + 4 new health files + implementation report. No outbox, auth, worker, or unrelated refactors in the diff.
- **Planned files:** All planned creates/modifies present. `.env.example` documented as planned.
- **Documented deviation:** `HealthModule.registerAsync()` added alongside sync `register({ checkTimeoutMs })`. Justified — mirrors other module wiring (`AppConfigService` factory at composition roots); sync `register` remains for explicit timeout injection without env reads in `HealthService`.

## Root-cause assessment

**Original defect:** `HealthService.check()` used unbounded `Promise.all([checkPostgres, checkRedis, checkBullMq])`. A hung DB/Redis/BullMQ I/O call blocked the entire health response, causing load-balancer/Kubernetes probe timeouts and request pile-up on `/health` and `/health/ready`.

**Fix addresses root cause:** Each probe is wrapped with `withHealthCheckTimeout(operation, checkTimeoutMs)` using `Promise.race` + timer cleanup. Checks run via `Promise.allSettled` so one hang does not block others beyond the per-check deadline. Timed-out or failed probes map to `services.<name> = 'error'` and overall `status = 'error'`.

**Not a symptom-only fix:** Configuration is typed (`HEALTH_CHECK_TIMEOUT_MS`), injected through module options (no `process.env` in `HealthService`), and wired at both composition roots.

## Acceptance criteria matrix

| Criterion                                                                                  | Status                                                          | Evidence                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed `HEALTH_CHECK_TIMEOUT_MS` in env schema with positive-integer validation and default | **passed**                                                      | `env.schema.ts`: `z.coerce.number().int().positive().default(3000)`; `.env.example` documents `3000`; `env.schema.spec.ts` tests default, override, reject zero/negative                |
| `HealthModule.register()` accepts explicit `checkTimeoutMs`                                | **passed**                                                      | `health.module.ts`: required `checkTimeoutMs` on sync `register()`; `HEALTH_MODULE_OPTIONS` token; no env reads in `HealthService`                                                      |
| Each dependency probe runs under individual timeout wrapper                                | **passed**                                                      | `runCheck()` calls `withHealthCheckTimeout(operation, this.options.checkTimeoutMs)` for postgres, redis, bullmq                                                                         |
| `HealthService.check()` uses `Promise.allSettled`                                          | **passed**                                                      | `health.service.ts` lines 36–44                                                                                                                                                         |
| Timed-out probes → `services.<name> = 'error'`, overall `status = 'error'`                 | **passed**                                                      | V-10 unit test: hanging postgres → `postgres: 'error'`, others `ok`, `status: 'error'`                                                                                                  |
| Timeout/error paths do not log credentials                                                 | **passed**                                                      | No `Logger`, `console`, or `process.env` in `libs/infrastructure/src/health/`; silent `catch` in `runCheck`; timeout message is generic (`Health check timed out after ${timeoutMs}ms`) |
| `/health/ready` and `/health` bounded when dependency hangs (V-10)                         | **passed**                                                      | Both endpoints delegate to `HealthService.check()` (controller unchanged); V-10 hang test completes in `< 250ms` with `checkTimeoutMs = 100`                                            |
| Public health JSON shape unchanged                                                         | **passed**                                                      | `{ status: 'ok' \| 'error', services: { postgres, redis, bullmq } }` — type and controller response contract unchanged                                                                  |
| `npm run build`, targeted unit tests, P2-05 lint pass                                      | **passed**                                                      | See commands below                                                                                                                                                                      |
| `npm run lint` (full repo)                                                                 | **passed (P2-05 scope)** / **failed (repo-wide, pre-existing)** | Changed-file eslint clean; full `npm run lint` fails on 4 unused-var errors in outbox files outside P2-05 diff (P2-04/P2-11 debt)                                                       |

## Dependency and DI verification

```text
process.env.HEALTH_CHECK_TIMEOUT_MS
  -> env.schema.ts (validate)
  -> infrastructure-config.module.ts (health.checkTimeoutMs)
  -> AppConfigService.health()
  -> mapAppConfigToHealthOptions()
  -> HealthModule.registerAsync({ useFactory })
  -> HEALTH_MODULE_OPTIONS provider
  -> HealthService factory (inject: DRIZZLE_DB, REDIS_CLIENT, OUTBOX queue, HEALTH_MODULE_OPTIONS)
  -> HealthController.ready() | check() -> health.check()
```

- **API composition root:** `apps/api/src/api.module.ts` — `HealthModule.registerAsync` with `InfrastructureConfigModule`, redis, drizzle, bullmq imports.
- **Deprecated facade:** `libs/infrastructure/src/infrastructure.module.ts` — same async wiring for parity.
- **Consumers updated:** Both prior `HealthModule.register({ imports })` call sites migrated; no remaining callers without timeout wiring.
- **Portability:** `HealthService` receives `HealthModuleOptions` only; sync `register({ checkTimeoutMs })` available for non-env consumers.

## Commands executed

| Command                                                                                                                                                                 | Result                                                                                    | Conclusion                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run test:unit -- --testPathPatterns=health`                                                                                                                        | Exit 0 — 2 suites, 6 tests passed                                                         | V-10 hang matrix and timeout helper tests pass            |
| `npm run test:unit -- --testPathPatterns=env.schema`                                                                                                                    | Exit 0 — 1 suite, 19 tests passed                                                         | `HEALTH_CHECK_TIMEOUT_MS` default/validation covered      |
| `npm run build:api`                                                                                                                                                     | Exit 0                                                                                    | API compiles with new DI wiring                           |
| `npm run build`                                                                                                                                                         | Exit 0                                                                                    | api, worker, cron, migrations compile                     |
| `npx eslint libs/infrastructure/src/health apps/api/src/api.module.ts libs/infrastructure/src/config libs/infrastructure/src/infrastructure.module.ts --max-warnings=0` | Exit 0                                                                                    | P2-05 changed files lint-clean                            |
| `npm run lint`                                                                                                                                                          | Exit 1 — 4 errors in `outbox-processor.defaults.ts`, `outbox-processor.options.schema.ts` | Pre-existing unrelated debt; not introduced by P2-05 diff |

## Findings

1. **Implementation matches approved plan** — config pipeline, timeout helper, `Promise.allSettled`, DI factory, tests, and `.env.example` align with plan steps 1–8.
2. **V-10 evidence confirmed independently** — `health.service.spec.ts` hang scenario passes at verification time (`elapsedMs < 250`, correct status mapping).
3. **`registerAsync` deviation is acceptable** — required for `AppConfigService`-driven wiring; documented in implementation report; does not expand behavioral scope.
4. **Breaking API surface (intentional):** `HealthModule.register()` now requires `checkTimeoutMs` (no default empty options). Both in-repo consumers updated; TypeScript enforces for external consumers.
5. **Full-repo lint gate red** — failures confined to outbox files not in P2-05 diff; P2-05 acceptance for changed-file lint is satisfied.

## Documentation alignment

- `.env.example` includes `# Health checks` section with `HEALTH_CHECK_TIMEOUT_MS=3000` and orchestrator-alignment comment — matches plan.
- Backlog P2-05 requirements (typed timeout, wrapper, `allSettled`, no credential logging, bounded readiness) satisfied.
- README/backlog index not updated — explicitly out of scope per plan.

## Remaining risks

- Underlying DB/Redis/BullMQ I/O continues after timeout (accepted per plan; same limitation as Outbox handler timeout in P2-04).
- Default 3000 ms may exceed aggressive orchestrator probe configs — operator must tune env or probe timeout.
- Slow but healthy cold start may report `error` once deadline exceeded — semantics unchanged from “slow = unhealthy” but now bounded.
- No manual curl/bootstrap against live hung Postgres — optional per plan; unit mocks are primary V-10 evidence.

## Unverified areas

- Full-repo `npm run lint` green status (blocked by pre-existing outbox unused-var errors).
- Full `npm run test:unit` green status (implementation report notes pre-existing outbox schema spec failure; not re-run in this verification).
- Manual runtime: API start + hung Postgres + `curl /health/ready` (requires local infra; not required for approval per plan).
