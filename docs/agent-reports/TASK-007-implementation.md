# TASK-007 — Implementation report

## Verdict

implemented

> Caveat on AC-07: `npm run build`, `npm run lint` and `npm run test:unit` all
> succeed. `npm run test:module` reports 10 suites passing and 1 suite failing
> (`apps/cron/src/cron.module.spec.ts`). That single failure is **pre-existing and
> unrelated to TASK-007** — it reproduces identically on the untouched `HEAD`
> (verified by stashing all TASK-007 production changes and re-running the spec).
> The failure is a BullMQ + mocked-`ioredis` incompatibility
> (`ioredis_1.default is not a constructor`), not a logger DI defect. See
> "Deviations" and "Unverified areas".

## Approved specification

- `docs/agent-tasks/TASK-007-logger-module-portability.md` (frontmatter
  `status: approved`).
- Goal: make `LoggerModule` portable via typed `forRoot`/`forRootAsync` accepting a
  narrow `{ level: string; pretty: boolean }` options object; `AppLogger` receives
  options through an injection token instead of `AppConfigService`; composition roots
  map `AppConfigService` → logger options; existing consumers keep a working
  `AppLogger`; TASK-006 pretty-in-development and request-context enrichment
  preserved; no HTTP/OpenAPI change.

## Approved plan

- `docs/agent-plans/TASK-007-logger-module-portability.md` (frontmatter
  `status: approved`).
- Architecture decision: convert `LoggerModule` into a **global dynamic module**
  registered exactly once per entrypoint. Consumers drop their dead `LoggerModule`
  import edges and inject `AppLogger` from the single global provider.

## Changed files

### Created

- `libs/infrastructure/src/logger/logger.module-options.ts` — `LoggerModuleOptions`
  type + `LOGGER_MODULE_OPTIONS` Symbol token.
- `libs/infrastructure/src/logger/logger.module.spec.ts` — AC-03 module spec
  (boots `forRoot` and `forRootAsync` without `InfrastructureConfigModule` /
  `AppConfigService`).

### Modified (production)

- `libs/infrastructure/src/logger/app-logger.service.ts` — inject
  `@Inject(LOGGER_MODULE_OPTIONS) options: LoggerModuleOptions`; build pino from
  `options.level`/`options.pretty`; removed `AppConfigService` import/injection.
- `libs/infrastructure/src/logger/logger.module.ts` — empty `@Module({})` base with
  `forRoot` / `forRootAsync` returning `global: true` dynamic modules; removed
  `InfrastructureConfigModule` import; added `LoggerModuleAsyncOptions`.
- `libs/infrastructure/src/config/create-starter-kit-module-options.ts` — added
  `mapAppConfigToLoggerOptions(config): LoggerModuleOptions`.
- `apps/api/src/api.module.ts` — register `LoggerModule.forRootAsync` once (global).
- `apps/worker/src/worker.module.ts` — same.
- `apps/cron/src/cron.module.ts` — same.
- `libs/infrastructure/src/infrastructure.module.ts` (facade) — register
  `LoggerModule.forRootAsync` in `imports`; keep `LoggerModule` in `exports`.
- `libs/infrastructure/src/redis/redis.module.ts` — removed dead `imports: [LoggerModule]`
  and the `LoggerModule` import (kept `AppLogger`).
- `libs/infrastructure/src/mail/mail.module.ts` — removed `LoggerModule` from both
  `forRoot` and `forRootAsync` imports arrays and the import (kept `AppLogger`).
- `libs/infrastructure/src/audit/audit.module.ts` — removed dead `LoggerModule` import edge.
- `libs/infrastructure/src/exceptions/exceptions.module.ts` — removed dead
  `imports: [LoggerModule]`.
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` — removed `LoggerModule`
  from `buildFeatureImports` and the import.
- `apps/api/src/composition/auth-application.module.ts` — removed dead `LoggerModule`
  import edge (kept `AppLogger`).

### Modified (tests)

- `libs/infrastructure/src/logger/app-logger.service.spec.ts` — new constructor
  `new AppLogger({ level, pretty }, requestContext)`; dropped `configFake`.
- `libs/infrastructure/src/redis/redis.module.spec.ts` — static `LoggerModule` entry
  replaced with `LoggerModule.forRoot({ level: 'info', pretty: false })`.
- `libs/infrastructure/src/mail/mail.module.spec.ts` — added
  `LoggerModule.forRoot({ level: 'error', pretty: false })` to both test imports.
- `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` — added
  `LoggerModule.forRoot(...)` to both test imports.
- `apps/api/src/composition/auth-application.module.spec.ts` — added
  `LoggerModule.forRoot(...)` to the testing module imports.

### Not changed by this task

- `docs/agent-tasks/INDEX.md` shows as modified in `git status`, but this
  modification pre-existed at the start of the task and was **not** touched here
  (per instruction: the parent handles the INDEX).
- Untracked docs (`docs/agent-plans/TASK-007-*`, `docs/agent-tasks/TASK-008/009/010`,
  `docs/agent-reports/full-review-2026-07-20.md`) pre-existed and were not authored
  by this implementation, except this report.
- `build-pino-options.ts` / `build-pino-options.spec.ts` — untouched (as required).

## Completed phases

- **Phase 1** — Options contract + `AppLogger` DI. Done.
- **Phase 2** — `LoggerModule` `forRoot`/`forRootAsync` as global dynamic module. Done.
- **Phase 3** — Composition-root wiring + `mapAppConfigToLoggerOptions`. Done.
- **Phase 4** — Removed dead consumer import edges. Done.
- **Phase 5** — Added AC-03 module spec; updated `AppLogger` + consumer specs. Done.
- **Phase 6** — Full verification + report. Done.

## Acceptance criteria self-check

- **AC-01** — `LoggerModule.forRoot({ level, pretty })` and
  `forRootAsync({ useFactory, inject?, imports? })` exist, compile, and produce a
  working `AppLogger`. Confirmed by `npm run build` and the new module spec. ✔
- **AC-02** — `AppLogger` no longer imports/injects `AppConfigService`; `LoggerModule`
  no longer imports `InfrastructureConfigModule`. Confirmed by diff and
  `rg AppConfigService libs/infrastructure/src/logger` (only test description strings
  remain). ✔
- **AC-03** — `logger.module.spec.ts` boots `LoggerModule` with explicit options
  without `InfrastructureConfigModule`/`AppConfigService` and resolves `AppLogger`,
  `RequestContextService`, `RequestContextMiddleware`. 2 tests pass. ✔
- **AC-04** — API/Worker/Cron register the logger once each; pretty vs JSON decision
  still lives in `InfrastructureConfigModule` (`NODE_ENV=development → pretty`),
  unchanged. `build:api/worker/cron` succeed. Runtime dev/prod boot not executed
  (infra unavailable) — see Unverified areas. ◐ (static + build verified)
- **AC-05** — `LOGGER_LEVEL` filtering preserved: `app-logger.service.spec.ts`
  filtering test passes under `npm run test:unit`. ✔
- **AC-06** — Request-context fields preserved: `app-logger.service.spec.ts`
  request-context merge test passes under `npm run test:unit`. ✔
- **AC-07** — `npm run build` ✔, `npm run lint` ✔, `npm run test:unit` ✔.
  `npm run test:module` — 10/11 suites pass; the single failing suite
  (`cron.module.spec.ts`) is a pre-existing, unrelated BullMQ/ioredis-mock failure
  (reproduced on `HEAD`). ◐
- **AC-08** — No OpenAPI/swagger schema/decorator/generated-document changes.
  `git diff --stat` shows no swagger/OpenAPI files touched. ✔

## Contract and DI changes

- New infrastructure-local contract `LoggerModuleOptions = { level: string; pretty: boolean }`
  and DI token `LOGGER_MODULE_OPTIONS = Symbol('LOGGER_MODULE_OPTIONS')` (kept in
  `libs/infrastructure/src/logger`, mirroring `MAIL_MODULE_OPTIONS`).
- `AppLogger` provider dependency changed from `AppConfigService` → `LOGGER_MODULE_OPTIONS`.
- `LoggerModule` public surface adds `forRoot` / `forRootAsync` (`global: true`);
  exported providers unchanged (`AppLogger`, `RequestContextService`,
  `RequestContextMiddleware`).
- NFR-03 (one logger config per entrypoint) is guaranteed by registering
  `LoggerModule.forRootAsync` exactly once per entrypoint as a global module;
  consumers no longer self-import `LoggerModule`.

## Database and migration changes

- None.

## Commands executed

1. `git status --short`
2. `npm run build:api`, `npm run build:worker`, `npm run build:cron` (after Phase 3)
3. `npm run build` (full, after Phase 4 and as final verification)
4. `npm run lint`
5. `npm run test:unit`
6. `npm run test:module`
7. `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand libs/infrastructure/src/logger/logger.module.spec.ts` (AC-03 isolated)
8. `git stash push -- <production files>` → run `cron.module.spec.ts` on HEAD → `git stash pop` (isolate the pre-existing cron failure)
9. `rg AppConfigService|InfrastructureConfigModule libs/infrastructure/src/logger`
10. `git diff --name-only`, `git diff --stat`, `git status --porcelain`

## Command results

- `npm run build:api` / `build:worker` / `build:cron` — exit 0 — entrypoints compile.
- `npm run build` — exit 0 — full compile passes (two transient Windows access-violation
  crashes, `-1073741819` / corrupted-read, occurred and were retried per the known
  Windows issue; the successful run is authoritative).
- `npm run lint` — exit 0 — no warnings/errors (`--max-warnings=0`).
- `npm run test:unit` — exit 0 — 35 suites / 206 tests passed. (Some `ExceptionsHandler`
  ERROR logs are expected output from pre-existing exception-filter tests exercising
  error paths.)
- `npm run test:module` — exit 1 — 10 suites / 21 tests passed; 1 suite / 1 test failed
  (`cron.module.spec.ts`).
- `cron.module.spec.ts` on stashed `HEAD` — same failure (`ioredis_1.default is not a
  constructor`) — confirms the failure is pre-existing and independent of TASK-007.
- `logger.module.spec.ts` isolated — exit 0 — 2 tests passed (AC-03).
- `rg` — `AppConfigService` / `InfrastructureConfigModule` appear in the logger folder
  only inside spec test-name strings; no production references remain (AC-02).
- `git diff --stat` — 19 tracked files changed (incl. pre-existing `docs/.../INDEX.md`);
  no swagger/OpenAPI files (AC-08).

## Deviations

- **No functional deviation from the approved plan.** All planned files, symbols and
  phases were implemented as specified.
- **AC-07 partial on `test:module`:** the plan expected all four commands to succeed.
  `cron.module.spec.ts` fails, but the failure is pre-existing on `HEAD` and unrelated
  to logging (BullMQ instantiating a real `Queue` against a mocked `ioredis` that lacks
  a usable default constructor). No production or test code owned by TASK-007 causes it;
  the TASK-007 logger changes were verified not to introduce it. This was treated as an
  environment/pre-existing-test issue, not a code defect from this task, and no
  out-of-scope fix was attempted.

## Documentation changes

- None to public/user-facing docs. Logging runtime behavior (levels, pretty-in-dev,
  JSON otherwise, request-context fields) is behaviorally identical; only the
  configuration source moved from an in-`AppLogger` `AppConfigService` read to an
  injected options token. This implementation report is the only doc added.

## Remaining risks

- **Single global registration discipline:** correctness of NFR-03 depends on each
  entrypoint registering `LoggerModule.forRootAsync` exactly once. Verified by
  inspection of `api`/`worker`/`cron` root modules and the facade; a future entrypoint
  must follow the same rule.
- **External integrators** must now register `LoggerModule.forRoot`/`forRootAsync`
  (or receive it from a host) instead of relying on the old static self-import — this
  is the intended portability contract, documented in the plan.

## Unverified areas

- **Runtime boot (AC-04) in `NODE_ENV=development` (pretty) and production-like
  (JSON):** not executed because local PostgreSQL/Redis were not started; API/Worker/Cron
  bootstrap depends on those services. Treated as infrastructure unavailability, not a
  code defect. Static wiring, `build:api/worker/cron`, and DI module specs cover the
  composition. The pretty/JSON decision is unchanged (still in
  `InfrastructureConfigModule`), so TASK-006 behavior is preserved by construction.
- **`cron.module.spec.ts`** remains red for the pre-existing BullMQ/ioredis-mock reason
  described above; fixing it is out of scope for TASK-007.
