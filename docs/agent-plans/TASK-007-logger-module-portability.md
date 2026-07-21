---
task_id: TASK-007
specification: docs/agent-tasks/TASK-007-logger-module-portability.md
status: approved
owner: human-approval-required
---

# TASK-007 — Implementation plan

## Approved specification

- Source: `docs/agent-tasks/TASK-007-logger-module-portability.md` (frontmatter `status: approved`).
- Goal: make `LoggerModule` portable by exposing typed `forRoot(options)` /
  `forRootAsync(asyncOptions)` accepting a narrow `{ level: string; pretty: boolean }`
  options object; `AppLogger` receives options via an injection token instead of
  `AppConfigService`; `LoggerModule` stops importing `InfrastructureConfigModule` in
  its portable path; composition roots (API/Worker/Cron and the deprecated
  `InfrastructureModule` facade) map `AppConfigService` → logger options and call
  `LoggerModule.forRootAsync`; all existing consumers keep receiving a working
  `AppLogger`; TASK-006 pretty-in-development and request-context enrichment are
  preserved; no HTTP/OpenAPI change.
- Functional requirements FR-01…FR-08 and non-functional NFR-01…NFR-04 as written.

## Current implementation

Inspected on the current branch (`main`). Note: the git snapshot referenced in the
task prompt (`M apps/api/src/api.module.ts`, `M app-logger.service*.ts`) is **stale** —
`git status`/`git diff` now show those files clean and matching `HEAD`; only
`docs/agent-tasks/INDEX.md` is modified and the new task docs are untracked. There is
**no** `libs/infrastructure/src/logger/index.ts` barrel; consumers import concrete file
paths, so there is no barrel to update.

- `libs/infrastructure/src/logger/logger.module.ts` — static `@Module` with
  `imports: [InfrastructureConfigModule]`, `providers`/`exports` of `AppLogger`,
  `RequestContextService`, `RequestContextMiddleware`. Because it is a **static class**,
  Nest shares one singleton instance across every importer today (this is what
  currently guarantees a single `AppLogger`).
- `libs/infrastructure/src/logger/app-logger.service.ts` — constructor injects
  `AppConfigService` and `RequestContextService`; builds pino via
  `pino(buildPinoRootOptions(config.logger().level, config.logger().pretty))`.
- `libs/infrastructure/src/logger/build-pino-options.ts` — pure helper
  `buildPinoRootOptions(level, pretty)`; portable as-is (do not change).
- `libs/infrastructure/src/logger/build-pino-options.spec.ts` — pure unit spec for the
  helper; unaffected.
- `libs/infrastructure/src/logger/app-logger.service.spec.ts` — constructs
  `new AppLogger(configFake, requestContextFake)` where `configFake.logger()` returns
  `{ level, pretty }`, then swaps the internal pino instance to a `Writable`. Covers
  JSON output + request-context merge (AC-06), Nest string-context mapping, and
  `LOGGER_LEVEL` filtering (AC-05). Must be updated for the new constructor signature.
- `libs/infrastructure/src/config/app-config.service.ts` — `logger()` returns exactly
  `{ level: string; pretty: boolean }` (the narrow shape the token needs).
- `libs/infrastructure/src/config/infrastructure-config.module.ts` — maps
  `NODE_ENV === 'development'` → `logger.pretty` (TASK-006 semantics live here, not in
  `AppLogger`).
- `libs/infrastructure/src/config/create-starter-kit-module-options.ts` — established
  `mapAppConfigTo*Options` mapper pattern (Redis/Drizzle/BullMq/Mail/Health/…); this
  is where the new logger mapper belongs.

Reference pattern to reuse (typed `forRoot`/`forRootAsync` + options **Symbol** token +
manual `DynamicModule`): `libs/infrastructure/src/mail/mail.module.ts` +
`libs/infrastructure/src/mail/mail.module-options.ts`
(`MAIL_MODULE_OPTIONS = Symbol('MAIL_MODULE_OPTIONS')`,
`type MailModuleAsyncOptions = Pick<FactoryProvider<...>, 'useFactory' | 'inject'> & { imports?: ModuleMetadata['imports'] }`).

Complete set of `LoggerModule` consumers that must keep resolving `AppLogger` after the
change (verified via search):

- Named in the spec: `redis/redis.module.ts`, `mail/mail.module.ts`,
  `audit/audit.module.ts`, `exceptions/exceptions.module.ts`.
- Additional real importers (must also be handled to avoid breaking DI, per change
  discipline): `outbox/outbox-processor.module.ts` (`buildFeatureImports`),
  `apps/api/src/composition/auth-application.module.ts`.
- Composition roots importing `LoggerModule` directly: `apps/api/src/api.module.ts`,
  `apps/worker/src/worker.module.ts`, `apps/cron/src/cron.module.ts`,
  `libs/infrastructure/src/infrastructure.module.ts` (facade).
- Specs that import/boot the above and must stay green:
  `redis/redis.module.spec.ts` (imports static `LoggerModule`),
  `mail/mail.module.spec.ts` (relies on `AppLogger` from imported `LoggerModule`),
  `outbox/outbox-processor.module.spec.ts` (boots `OutboxProcessorModule` standalone),
  `apps/api/src/composition/auth-application.module.spec.ts` (boots the composition
  module standalone), `apps/cron/src/cron.module.spec.ts` (boots `CronModule`).

Downstream services that inject `AppLogger` and therefore depend on it being resolvable:
`RedisModule` (`REDIS_CLIENT` factory), `NullMailAdapter`, `AuditLogger`,
`GlobalExceptionFilter` — all confirmed.

## Architecture decision

**Convert `LoggerModule` into a global dynamic module configured once per entrypoint.**

1. New options contract (Mail-style):
   - `LoggerModuleOptions = { level: string; pretty: boolean }` (minimal per FR-01,
     object type kept extensible).
   - `LOGGER_MODULE_OPTIONS = Symbol('LOGGER_MODULE_OPTIONS')` injection token.
   - `LoggerModuleAsyncOptions = Pick<FactoryProvider<LoggerModuleOptions>, 'useFactory' | 'inject'> & { imports?: ModuleMetadata['imports'] }`.
2. `AppLogger` injects `@Inject(LOGGER_MODULE_OPTIONS) options: LoggerModuleOptions`
   (plus the unchanged `RequestContextService`) and builds pino via
   `pino(buildPinoRootOptions(options.level, options.pretty))`. It no longer imports or
   injects `AppConfigService` (FR-02, FR-03, AC-02).
3. `LoggerModule` becomes an empty `@Module({})` base exposing:
   - `static forRoot(options: LoggerModuleOptions): DynamicModule`
   - `static forRootAsync(asyncOptions: LoggerModuleAsyncOptions): DynamicModule`
   Both return `{ module: LoggerModule, global: true, imports: [...(async imports)],
   providers: [<LOGGER_MODULE_OPTIONS provider>, AppLogger, RequestContextService,
   RequestContextMiddleware], exports: [AppLogger, RequestContextService,
   RequestContextMiddleware] }`.
4. Composition roots call `LoggerModule.forRootAsync({ imports:[InfrastructureConfigModule],
   inject:[AppConfigService], useFactory: (c) => mapAppConfigToLoggerOptions(c) })`
   exactly once each (FR-04). Consumer modules **drop** their now-dead
   `imports: [LoggerModule]` (a bare-class import of an empty dynamic module provides
   nothing) and inject `AppLogger` from the global provider.

**How NFR-03 (one logger config per entrypoint) is guaranteed.** Today the static class
gives a shared singleton; a dynamic module would instead create a *distinct* `AppLogger`
per `forRootAsync` call, so if each consumer registered its own, configs could diverge.
The design forbids that: `LoggerModule` is registered exactly **once** per entrypoint at
the composition root as `global: true`. A global module's exported providers are visible
to every module in the injector tree without being imported, so `RedisModule`,
`MailModule`, `AuditModule`, `ExceptionsModule`, `OutboxProcessorModule` and the auth
composition module all receive the *same* single configured `AppLogger`
(FR-05, NFR-03). Consumers no longer self-import `LoggerModule`, which structurally
prevents accidental second instances. This mirrors the idiomatic Nest treatment of a
cross-cutting logger and keeps the portable contract "the host must register a
`LoggerModule` with options" (no `AppConfigService` requirement).

`buildPinoRootOptions` stays the pure pretty/JSON boundary (NFR-01, NFR-02, FR-07); the
`NODE_ENV=development → pretty` decision remains in `InfrastructureConfigModule`
(TASK-006 preserved, AC-04). Exported symbols `AppLogger`, `RequestContextService`,
`RequestContextMiddleware` remain exported (NFR-04, FR-06).

## Scope

- Add typed logger options contract + token.
- Rework `AppLogger` DI and `LoggerModule` into global `forRoot`/`forRootAsync`.
- Add `mapAppConfigToLoggerOptions` mapper.
- Update the four composition roots (API/Worker/Cron + `InfrastructureModule` facade) to
  register `LoggerModule.forRootAsync`.
- Remove dead `LoggerModule` imports from all consumer modules and let them use the
  global `AppLogger`.
- Update affected specs and add the AC-03 logger module spec.

## Out of scope

- Changing log schema, redaction, or request-context semantics.
- Bringing Migrations onto `AppLogger`.
- Removing the deprecated `InfrastructureModule` facade.
- Restructuring the Redis/Mail/Audit/Exceptions → Logger relationship beyond removing
  the now-unnecessary import edges.
- Any HTTP/OpenAPI change.
- Modifying `build-pino-options.ts` / `build-pino-options.spec.ts`.

## Files to create

- `libs/infrastructure/src/logger/logger.module-options.ts`
  - `export type LoggerModuleOptions = { level: string; pretty: boolean };`
  - `export const LOGGER_MODULE_OPTIONS = Symbol('LOGGER_MODULE_OPTIONS');`
- `libs/infrastructure/src/logger/logger.module.spec.ts` (AC-03 module spec).

## Files to modify

- `libs/infrastructure/src/logger/app-logger.service.ts` — replace `AppConfigService`
  injection with `@Inject(LOGGER_MODULE_OPTIONS) options: LoggerModuleOptions`; build
  pino from `options.level`/`options.pretty`; drop the `AppConfigService` import.
- `libs/infrastructure/src/logger/logger.module.ts` — remove
  `InfrastructureConfigModule` import; empty `@Module({})`; add `forRoot`/`forRootAsync`
  returning `global: true` dynamic modules that provide/export `AppLogger`,
  `RequestContextService`, `RequestContextMiddleware` and the options provider; add
  `LoggerModuleAsyncOptions` type.
- `libs/infrastructure/src/logger/app-logger.service.spec.ts` — construct
  `new AppLogger({ level, pretty }, requestContextFake)` (drop the `configFake`); keep
  the three existing assertions (JSON+request-context AC-06, nest-context mapping,
  `LOGGER_LEVEL` filtering AC-05).
- `libs/infrastructure/src/config/create-starter-kit-module-options.ts` — add
  `export function mapAppConfigToLoggerOptions(config: AppConfigService): LoggerModuleOptions
  { return config.logger(); }` and import the `LoggerModuleOptions` type.
- `libs/infrastructure/src/redis/redis.module.ts` — remove `LoggerModule` from the
  `@Module` `imports`; drop the unused `LoggerModule` import line (keep the `AppLogger`
  import used by the `REDIS_CLIENT` factory `inject`).
- `libs/infrastructure/src/redis/redis.module.spec.ts` — replace the static
  `LoggerModule` import entry with `LoggerModule.forRoot({ level: 'info', pretty: false })`
  (keeps the `.overrideProvider(AppLogger)` working and the "no InfrastructureConfigModule"
  intent).
- `libs/infrastructure/src/mail/mail.module.ts` — remove `LoggerModule` from both the
  `forRoot` and `forRootAsync` `imports` arrays; remove the now-unused `LoggerModule`
  import (keep `AppLogger`). Leave the deprecated `forRootFromAppConfig` behavior intact.
- `libs/infrastructure/src/mail/mail.module.spec.ts` — add
  `LoggerModule.forRoot({ level: 'error', pretty: false })` to both test `imports` arrays
  so `AppLogger` resolves for `NullMailAdapter`/`SmtpMailAdapter` (override on the null
  test still applies).
- `libs/infrastructure/src/audit/audit.module.ts` — remove `LoggerModule` from
  `register` `imports`; drop the unused import.
- `libs/infrastructure/src/exceptions/exceptions.module.ts` — remove
  `imports: [LoggerModule]`; drop the unused import (keep `GlobalExceptionFilter`).
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` — remove `LoggerModule`
  from `buildFeatureImports`; drop the unused import.
- `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` — add
  `LoggerModule.forRoot({ level: 'error', pretty: false })` to the test `imports` so the
  standalone boot resolves `AppLogger` (used transitively via Audit/Events).
- `libs/infrastructure/src/infrastructure.module.ts` (facade) — replace the
  `LoggerModule` import entry with
  `const loggerModule = LoggerModule.forRootAsync({ imports:[InfrastructureConfigModule],
  inject:[AppConfigService], useFactory:(c)=>mapAppConfigToLoggerOptions(c) })`, put
  `loggerModule` in `imports`, and keep `LoggerModule` in `exports` (consistent with how
  the facade already exports the class token for `RedisModule`/`MailModule` dynamic
  registrations).
- `apps/api/src/api.module.ts` — replace the `LoggerModule` entry in `imports` with a
  `LoggerModule.forRootAsync({...mapAppConfigToLoggerOptions...})` registration; keep the
  `RequestContextMiddleware` import used by `configure()` (it resolves from the global
  logger provider); import `mapAppConfigToLoggerOptions`.
- `apps/worker/src/worker.module.ts` — same replacement of the `LoggerModule` entry.
- `apps/cron/src/cron.module.ts` — same replacement of the `LoggerModule` entry.
- `apps/api/src/composition/auth-application.module.ts` — remove `LoggerModule` from
  `imports`; drop the unused import (AppLogger comes from the global registration in
  `ApiModule`).
- `apps/api/src/composition/auth-application.module.spec.ts` — add
  `LoggerModule.forRoot({ level: 'error', pretty: false })` to the testing module
  `imports` so the standalone boot resolves `AppLogger` (override still applies).
- `apps/cron/src/cron.module.spec.ts` — no source change expected (CronModule now
  registers the global logger); confirm the existing `.overrideProvider(AppLogger)`
  still resolves after implementation. Adjust only if the boot fails.

## Files to delete

- None.

## Domain changes

- None (NFR-02: no pino/Nest logger imports enter Domain/Application).

## Application changes

- None.

## Contract and DI changes

- New infrastructure-local options contract `LoggerModuleOptions` and DI token
  `LOGGER_MODULE_OPTIONS` (kept in `libs/infrastructure/src/logger`, not in
  `libs/contracts`, matching `MAIL_MODULE_OPTIONS`, which is defined in infrastructure).
- `AppLogger` provider dependency changes from `AppConfigService` → `LOGGER_MODULE_OPTIONS`.
- `LoggerModule` public surface adds `forRoot`/`forRootAsync`; exported providers
  unchanged (`AppLogger`, `RequestContextService`, `RequestContextMiddleware`).

## Infrastructure changes

- As enumerated in "Files to create/modify". Redis/Mail/Audit/Exceptions/Outbox modules
  keep behavior; only their dead `LoggerModule` import edges are removed. TASK-006
  pretty/JSON boundary and request-context middleware behavior unchanged.

## Interface and entrypoint changes

- API/Worker/Cron root modules register the logger via `forRootAsync` (global) instead of
  importing the static module. No controllers, DTOs, routes, guards or middleware
  wiring semantics change; `RequestContextMiddleware` is still applied in
  `ApiModule.configure()`.
- `InfrastructureModule` facade keeps compiling and exporting `LoggerModule`.

## Database and migration changes

- None.

## Security and authorization changes

- None. What is logged is unchanged; pretty transport is still dev-only and production
  does not require `pino-pretty` (TASK-006 preserved).

## Observability changes

- Log output (levels, pretty-in-dev, JSON otherwise, request-context fields) is
  behaviorally identical; only the configuration source moves from an `AppConfigService`
  read inside `AppLogger` to an injected options token.

## Implementation phases

### Phase 1 — Options contract + AppLogger DI (FR-01 partial, FR-02, FR-03, FR-07)
- Create `libs/infrastructure/src/logger/logger.module-options.ts`
  (`LoggerModuleOptions`, `LOGGER_MODULE_OPTIONS`).
- Modify `libs/infrastructure/src/logger/app-logger.service.ts` to inject
  `LOGGER_MODULE_OPTIONS`; remove `AppConfigService` import/usage; keep
  `RequestContextService` and `buildPinoRootOptions` usage.
- Update `libs/infrastructure/src/logger/app-logger.service.spec.ts` to the new
  constructor signature.
- Maps to: AC-02, AC-05, AC-06.
- Verify: `npm run test:unit` (logger + build-pino specs); targeted TypeScript via
  `npm run build`.

### Phase 2 — LoggerModule forRoot/forRootAsync as global dynamic module (FR-01, FR-03, FR-06, NFR-03, NFR-04)
- Rewrite `libs/infrastructure/src/logger/logger.module.ts`: empty `@Module({})`,
  add `forRoot`/`forRootAsync` returning `global: true` dynamic modules providing/exporting
  `AppLogger`, `RequestContextService`, `RequestContextMiddleware` + the options provider;
  remove `InfrastructureConfigModule` import; add `LoggerModuleAsyncOptions`.
- Maps to: AC-01, AC-02.
- Verify: `npm run build`; inspect diff for removed `InfrastructureConfigModule` import.

### Phase 3 — Composition-root wiring (FR-04, FR-05, AC-04)
- Add `mapAppConfigToLoggerOptions` to
  `libs/infrastructure/src/config/create-starter-kit-module-options.ts`.
- Update `apps/api/src/api.module.ts`, `apps/worker/src/worker.module.ts`,
  `apps/cron/src/cron.module.ts`, and `libs/infrastructure/src/infrastructure.module.ts`
  to register `LoggerModule.forRootAsync` (once each) with the mapper.
- Maps to: AC-01, AC-04.
- Verify: `npm run build:api`, `npm run build:worker`, `npm run build:cron`,
  `npm run build`.

### Phase 4 — Remove dead consumer imports (FR-05, NFR-03)
- Remove `LoggerModule` import edges from `redis.module.ts`, `mail/mail.module.ts`,
  `audit/audit.module.ts`, `exceptions/exceptions.module.ts`,
  `outbox/outbox-processor.module.ts`, `apps/api/src/composition/auth-application.module.ts`.
- Maps to: AC-01, AC-02, AC-04.
- Verify: `npm run build` (no `UnknownDependenciesException` at compile) followed by
  Phase 6 DI boot tests.

### Phase 5 — Tests (AC-03, AC-05, AC-06)
- Create `libs/infrastructure/src/logger/logger.module.spec.ts`: boot
  `LoggerModule.forRoot({ level: 'info', pretty: false })` (and a `forRootAsync` variant)
  in `Test.createTestingModule` **without** `InfrastructureConfigModule`/`AppConfigService`;
  assert `moduleRef.get(AppLogger)` is an `AppLogger` and `RequestContextService` /
  `RequestContextMiddleware` resolve.
- Update the consumer specs listed in "Files to modify" (`redis`, `mail`,
  `outbox-processor`, `auth-application`) to register a `LoggerModule.forRoot(...)`; verify
  `cron.module.spec.ts` still passes.
- Maps to: AC-03, AC-05, AC-06.
- Verify: `npm run test:unit`, `npm run test:module`.

### Phase 6 — Full verification + runtime spot check (AC-04, AC-05, AC-06, AC-07, AC-08)
- Run `npm run build`, `npm run lint`, `npm run test:unit`, `npm run test:module`.
- Boot API with `NODE_ENV=development` (expect pretty) and a production-like
  `NODE_ENV=production` (expect JSON); spot-check Worker/Cron; confirm `LOGGER_LEVEL`
  filtering and request-context fields in output.
- Inspect `git diff` to confirm no OpenAPI/swagger schema/decorator/generated-document
  changes (AC-08).
- Maps to: AC-04..AC-08.

## Dependency and compatibility impact

- No new third-party dependencies; `package.json` / `package-lock.json` unchanged
  (NFR-01).
- Backward compatible for in-repo consumers: exported logger symbols unchanged; API/Worker/
  Cron/facade updated in the same task. Behavior change is limited to the removal of the
  implicit `LoggerModule` self-import in consumer modules — acceptable because a single
  global registration replaces it per entrypoint.
- External integrators gain a portable contract: register `LoggerModule.forRoot`/
  `forRootAsync` instead of depending on `AppConfigService`.

## Targeted verification

- `npm run build` — after Phases 1–2 and again after Phase 4.
- `npm run build:api` / `build:worker` / `build:cron` — after Phase 3.
- `npm run test:unit` — logger unit specs (Phases 1, 5).
- `npm run test:module` — DI boot specs incl. new logger module spec (Phase 5).

## Full verification

- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm run test:module`
- Runtime boot: `npm run start:api` with `NODE_ENV=development` then production-like env;
  spot-check `npm run start:worker` / `npm run start:cron`.
- `git diff` review for AC-02 (removed AppConfig coupling) and AC-08 (no OpenAPI changes).

Record each command as command / result / conclusion. Treat missing PostgreSQL/Redis as
infrastructure unavailability, not a code defect, during boot checks.

## Acceptance criteria mapping

| AC | Requirement | Phase | Verification |
| --- | --- | --- | --- |
| AC-01 | `forRoot({level,pretty})` & `forRootAsync({useFactory,inject?,imports?})` exist, compile, produce a working `AppLogger` | 2, 3 | `npm run build`; new `logger.module.spec.ts` via `npm run test:module` |
| AC-02 | `AppLogger` no longer injects `AppConfigService`; `LoggerModule` no longer imports `InfrastructureConfigModule` (in diff) | 1, 2, 4 | `git diff` inspection + `rg "AppConfigService" libs/infrastructure/src/logger` returns nothing; `npm run build` |
| AC-03 | Module spec boots `LoggerModule` with explicit options without `InfrastructureConfigModule`/`AppConfigService` and resolves `AppLogger` | 5 | `npm run test:module` (`logger.module.spec.ts`) |
| AC-04 | API/Worker/Cron bootstrap and log; pretty in `NODE_ENV=development`, JSON otherwise (TASK-006) | 3 | `npm run build:api/worker/cron`; runtime boot in dev + production-like env |
| AC-05 | `LOGGER_LEVEL` still filters in both modes | 1, 5 | `app-logger.service.spec.ts` filtering test via `npm run test:unit`; runtime spot check |
| AC-06 | Request-context fields remain present in output | 1, 5 | `app-logger.service.spec.ts` request-context test via `npm run test:unit`; runtime spot check |
| AC-07 | `npm run build`, `lint`, `test:unit`, `test:module` succeed | 6 | run all four |
| AC-08 | No OpenAPI schema/decorator/generated-document changes in the diff | 6 | `git diff` shows no swagger/OpenAPI files touched; no drift-test change required |

No acceptance criterion is omitted. OpenAPI is unaffected (AC-08): no controllers, DTOs,
decorators, or generated document change, and no drift-test modification is needed.

## Rollout strategy

- Backward compatible; ship as one change with composition roots updated together. No
  feature flag, migration, or staged rollout required.

## Rollback strategy

- Revert the single logger/config/composition commit. No data or schema impact; logging
  reverts to the `AppConfigService`-coupled static module.

## Risks

- **Misconfigured options factory** could disable pretty or change level — mitigated by
  the new module spec, the preserved `AppLogger` unit specs, and dev/prod boot checks
  (AC-04/05).
- **Missed consumer import** would surface as an `UnknownDependenciesException` for
  `AppLogger` at boot — mitigated by enumerating all consumers above and running
  `npm run test:module` (which boots Redis/Mail/Outbox/Cron/auth-composition modules).
- **Double global registration** would create ambiguous logger config — mitigated by the
  rule "register `LoggerModule.forRootAsync` exactly once per entrypoint" (verified by
  inspection of each root's `imports`).
- **Standalone consumer specs** losing the implicit logger — explicitly addressed by
  adding `LoggerModule.forRoot(...)` to the affected specs.

## Open questions requiring human decision

1. **Deprecated `LoggerModule.forRootFromAppConfig` bridge?**
   Recommended: **No — cut over composition roots directly** to `forRootAsync` with
   `mapAppConfigToLoggerOptions`. All four in-repo roots (API/Worker/Cron + facade) are
   updated in this task, so no internal migration window exists, and adding an
   AppConfig-backed helper partially re-couples the module against the very goal of the
   task. (Trade-off: Redis/Mail keep such a helper for external parity; a reviewer may
   prefer symmetry — human to decide.)
2. **Consumer wiring model.** Recommended: **composition-root-owned global logger** —
   consumers drop their internal `LoggerModule` imports and inject `AppLogger` from the
   single `global: true` registration per entrypoint. This guarantees NFR-03 by
   construction and is idiomatic for a cross-cutting logger, at the cost of consumer
   modules no longer being standalone without a host-registered logger (acceptable and
   documented). The alternative — non-global `LoggerModule` threaded through every
   consumer's `imports` passthrough — is more wiring and easier to get wrong.
3. **Options shape.** Recommended: **minimal `LoggerModuleOptions = { level: string;
   pretty: boolean }`** now (satisfies FR-01 "at minimum"), kept as an extensible object
   type so future fields (redaction, base fields) can be added without a breaking change.
   Avoid speculative fields today.
