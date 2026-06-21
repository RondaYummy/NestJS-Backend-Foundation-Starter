# P2-05 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-05-health-check-bounded-deadlines.md` (`status: approved`)

## Changed files

| Path                                                                  | Change                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `libs/infrastructure/src/health/health.module-options.ts`             | **Created** — `HealthModuleOptions` and `HEALTH_MODULE_OPTIONS` token            |
| `libs/infrastructure/src/health/with-health-check-timeout.ts`         | **Created** — `Promise.race` timeout helper with `clearTimeout` in `finally`     |
| `libs/infrastructure/src/health/with-health-check-timeout.spec.ts`    | **Created** — unit tests for resolve, timeout reject, timer cleanup              |
| `libs/infrastructure/src/health/health.service.spec.ts`               | **Created** — V-10 hang matrix (hanging postgres, thrown errors, all healthy)    |
| `libs/infrastructure/src/health/health.service.ts`                    | Refactored to inject options, wrap probes with timeout, use `Promise.allSettled` |
| `libs/infrastructure/src/health/health.module.ts`                     | Accept `checkTimeoutMs`; factory DI for `HealthService`; added `registerAsync()` |
| `libs/infrastructure/src/config/env.schema.ts`                        | Added `HEALTH_CHECK_TIMEOUT_MS` (positive int, default 3000)                     |
| `libs/infrastructure/src/config/app-config.service.ts`                | Added `health()` accessor and `ConfigShape.health`                               |
| `libs/infrastructure/src/config/infrastructure-config.module.ts`      | Maps `HEALTH_CHECK_TIMEOUT_MS` → `health.checkTimeoutMs`                         |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | Added `mapAppConfigToHealthOptions()`                                            |
| `libs/infrastructure/src/config/env.schema.spec.ts`                   | Tests for default, override, and validation of `HEALTH_CHECK_TIMEOUT_MS`         |
| `apps/api/src/api.module.ts`                                          | Wires `HealthModule.registerAsync()` with `mapAppConfigToHealthOptions`          |
| `libs/infrastructure/src/infrastructure.module.ts`                    | Same timeout wiring for deprecated facade parity                                 |
| `.env.example`                                                        | Documented `HEALTH_CHECK_TIMEOUT_MS=3000` under `# Health checks`                |

## Completed steps

1. **Options and token** — `health.module-options.ts` with `HealthModuleOptions` / `HEALTH_MODULE_OPTIONS`.
2. **Timeout helper** — `withHealthCheckTimeout()` using `setTimeout` + `clearTimeout` in `finally`; generic timeout message (no credentials).
3. **Config pipeline** — env schema, config module mapper, `AppConfigService.health()`, `mapAppConfigToHealthOptions()`.
4. **HealthService refactor** — private `runCheck()` wraps each probe; `Promise.allSettled`; silent catch (no logging of driver errors).
5. **HealthModule DI** — sync `register({ checkTimeoutMs })` and async `registerAsync()` with factory provider for `HealthService`.
6. **Composition roots** — `api.module.ts` and `infrastructure.module.ts` pass timeout via `AppConfigService` factory.
7. **Tests** — timeout helper specs, V-10 health service specs, env schema specs.
8. **`.env.example`** — documented variable with probe-alignment comment.

## Deviations

- Added `HealthModule.registerAsync()` in addition to sync `register()`. Required to wire `checkTimeoutMs` from `AppConfigService` at composition roots (plan step 6: “mirror other module wiring”). Sync `register({ checkTimeoutMs })` remains available for tests and non-env consumers.

## Commands executed

| Command                                                                                                                                                                 | Result                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit -- --testPathPatterns=health`                                                                                                                        | Pass (2 suites, 6 tests)                                                                                                                                       |
| `npm run test:unit -- --testPathPatterns=env.schema`                                                                                                                    | Pass (1 suite, 19 tests)                                                                                                                                       |
| `npm run build:api`                                                                                                                                                     | Pass                                                                                                                                                           |
| `npm run build`                                                                                                                                                         | Pass (api, worker, cron, migrations)                                                                                                                           |
| `npx eslint libs/infrastructure/src/health apps/api/src/api.module.ts libs/infrastructure/src/config libs/infrastructure/src/infrastructure.module.ts --max-warnings=0` | Pass                                                                                                                                                           |
| `npm run lint`                                                                                                                                                          | Fail — 4 pre-existing errors in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (P2-11 / in-flight P2-04 scope; not modified by P2-05) |
| `npm run test:unit`                                                                                                                                                     | Fail — 1 pre-existing failure in `outbox-processor.options.schema.spec.ts` (expects `handlerTimeoutMs: 300_000`, receives `0`; P2-11 / in-flight P2-04 scope)  |

## Command results

- **P2-05 targeted tests:** all pass with runtime evidence including V-10 hang scenario (`postgres` hang completes within 250 ms, marks `postgres: error`, others `ok`).
- **Build:** all entrypoints compile with new DI wiring.
- **P2-05 changed files lint:** clean.
- **Full lint / full unit suite:** blocked by pre-existing in-flight outbox failures outside P2-05 diff.

## Acceptance criteria self-check

| Criterion                                                                                  | Status                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Typed `HEALTH_CHECK_TIMEOUT_MS` in env schema with positive-integer validation and default | Met                                                     |
| `HealthModule.register()` accepts explicit `checkTimeoutMs`                                | Met                                                     |
| Each dependency probe runs under individual timeout wrapper                                | Met                                                     |
| `HealthService.check()` uses `Promise.allSettled` for isolated completion                  | Met                                                     |
| Timed-out probes map to `services.<name> = 'error'` and overall `status = 'error'`         | Met — V-10 unit test                                    |
| Timeout/error paths do not log credentials or driver payloads                              | Met — silent catch, generic timeout message only        |
| `/health/ready` and `/health` bounded when dependency hangs (V-10)                         | Met — unit evidence                                     |
| Public health JSON shape unchanged                                                         | Met                                                     |
| `npm run build` passes                                                                     | Met                                                     |
| `npm run lint` and targeted unit tests pass                                                | Targeted pass; full-repo lint blocked by unrelated debt |

## Remaining risks

- Underlying DB/Redis/BullMQ I/O continues after timeout (accepted per plan; same as Outbox timeout limitation).
- Default 3000 ms may exceed aggressive orchestrator probe configs — operators tune via env or probe timeout.
- No runtime curl/bootstrap check against live hung Postgres (optional per plan; unit mocks are primary V-10 evidence).

## Unverified areas

- Full-repo `npm run lint` and `npm run test:unit` green status (blocked by unrelated pre-existing / in-flight outbox failures).
- Manual runtime check: start API with `HEALTH_CHECK_TIMEOUT_MS=500`, simulate hung Postgres, curl `/health/ready` (requires local infra).
