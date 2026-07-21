---
task_id: TASK-007
task_type: refactor
status: approved
owner: human-approval-required
---

# TASK-007 — LoggerModule portable configuration (decouple from AppConfigService)

## Original request

Створити завдання на всі High-проблеми з рев'ю переносимості
(`docs/agent-reports/full-review-2026-07-20.md`). Ця задача покриває High-проблему:
`LoggerModule` не має `forRoot`/`forRootAsync` і жорстко залежить від
`AppConfigService`, що каскадом робить непереносними Redis/Mail/Audit/Exceptions.

## Problem or opportunity

`LoggerModule` is a static `@Module` that imports `InfrastructureConfigModule`, and
`AppLogger` injects `AppConfigService` directly. This violates
`.cursor/rules/20-module-portability.mdc` ("a reusable module must not require
`AppConfigService` as its only configuration API"). Because `RedisModule`,
`MailModule`, `AuditModule` and `ExceptionsModule` all import `LoggerModule`, any
consumer that reuses one of those modules transitively pulls in the starter's env
schema and `AppConfigService`, defeating standalone reuse.

This is a technical/portability refactor, not a backlog defect: logging works as
designed today; the gap is the missing typed registration contract.

## Goal

`LoggerModule` exposes typed `forRoot` / `forRootAsync` registration accepting a
narrow options object (log level + pretty flag), and `AppLogger` receives those
options through an injection token instead of `AppConfigService`. The starter maps
`AppConfigService` -> logger options only at the composition root. Existing runtime
log behavior (levels, pretty in development per TASK-006, request-context
enrichment) is preserved.

## Users and actors

- Integrators reusing `LoggerModule` (directly or via Redis/Mail/Audit/Exceptions)
  in another project without adopting this starter's `AppConfigService`.
- Local developers and operators consuming API/Worker/Cron logs.
- Maintainers of the starter's composition roots.

## Current system context

Inspected on the current branch:

- `libs/infrastructure/src/logger/logger.module.ts` — static `@Module`,
  `imports: [InfrastructureConfigModule]`, provides/exports `AppLogger`,
  `RequestContextService`, `RequestContextMiddleware`.
- `libs/infrastructure/src/logger/app-logger.service.ts` — constructor injects
  `AppConfigService`; builds pino via
  `buildPinoRootOptions(config.logger().level, config.logger().pretty)`.
- `libs/infrastructure/src/logger/build-pino-options.ts` — already a pure helper
  `buildPinoRootOptions(level: string, pretty: boolean)`; portable as-is.
- Consumers importing `LoggerModule`:
  - `redis.module.ts` (`@Module({ imports: [LoggerModule] })`),
  - `mail.module.ts` (`forRoot`/`forRootAsync` import LoggerModule),
  - `audit.module.ts` (`register` always imports LoggerModule),
  - `exceptions/exceptions.module.ts` (imports LoggerModule).
- Composition roots consuming `AppConfigService` mappers live in
  `libs/infrastructure/src/config/create-starter-kit-module-options.ts`.
- TASK-006 (approved) added the `pretty` flag flowing `NODE_ENV=development` ->
  `config.logger().pretty` -> `buildPinoRootOptions`. This task must not regress
  that behavior.

## Functional requirements

- **FR-01:** `LoggerModule` must expose a typed static registration API
  (`forRoot(options)` and `forRootAsync(asyncOptions)`) that accepts a narrow
  options shape, at minimum `{ level: string; pretty: boolean }`.
- **FR-02:** `AppLogger` must obtain its level and pretty flag from an injected
  logger-options token (provided by the registration API), not from
  `AppConfigService`.
- **FR-03:** `LoggerModule` must not import `InfrastructureConfigModule` or depend
  on `AppConfigService` in its default/portable registration path.
- **FR-04:** The starter's composition roots (API/Worker/Cron, and the deprecated
  `InfrastructureModule` facade) must map `AppConfigService` -> logger options via a
  mapper (e.g. extend `create-starter-kit-module-options.ts`) and pass them to
  `LoggerModule.forRootAsync`.
- **FR-05:** All current `LoggerModule` consumers (`RedisModule`, `MailModule`,
  `AuditModule`, `ExceptionsModule`) must continue to receive a working `AppLogger`
  after the change, using the configured logger instance from the composition root
  (single logger configuration per entrypoint).
- **FR-06:** `RequestContextService` and `RequestContextMiddleware` exports must
  remain available from `LoggerModule` with unchanged behavior.
- **FR-07:** Pretty-vs-JSON behavior from TASK-006 must be preserved (pretty only in
  development), now driven by the injected options rather than by AppConfig read
  inside `AppLogger`.
- **FR-08:** OpenAPI and HTTP contracts are unaffected (no endpoint/DTO/schema
  changes).

## Non-functional requirements

- **NFR-01:** No new logging library; keep pino + `buildPinoRootOptions`.
- **NFR-02:** Domain and application layers must not gain pino/Nest logger imports.
- **NFR-03:** Only one pino logger configuration per entrypoint (no duplicate
  `AppLogger` instances with divergent config across importing modules).
- **NFR-04:** Backward compatibility: existing exported symbols (`AppLogger`,
  `RequestContextService`, `RequestContextMiddleware`) remain exported.

## Public API and interface impact

Module registration API changes only (`LoggerModule.forRoot` / `forRootAsync`
added). No HTTP/SDK/CLI surface change.

### HTTP API contract (if applicable)

Not applicable.

- Methods and paths: none
- Request/response/validation: none
- Status codes and error envelope: none
- Auth: none
- Headers/cookies: none
- OpenAPI schemas/decorators to add or update: **none — OpenAPI unaffected**
- Acceptance criterion verifying generated OpenAPI: **N/A**

## Data model and migration impact

None.

## Events, queues and background processing

None directly. Worker/Cron only inherit the new logger wiring.

## Security and authorization

- No change to what is logged; pretty must not add secret exposure.
- Production path must not require `pino-pretty` (unchanged from TASK-006).

## Entrypoints and deployment impact

| Entrypoint | Impact |
| ---------- | ------ |
| API | Register `LoggerModule.forRootAsync` at composition root with mapped options |
| Worker | Same |
| Cron | Same |
| Migrations | Uses `console.*`; out of scope |
| `InfrastructureModule` facade (deprecated) | Must be updated to register LoggerModule with options so it keeps compiling |

## Observability and operations

- Same log output as today (levels, pretty-in-dev, request context).
- No new metrics/tracing.

## Compatibility requirements

- Do not change Nest `LoggerService` method signatures on `AppLogger`.
- Keep `LOGGER_LEVEL` and `NODE_ENV=development` pretty semantics.
- Any transitional retention of an AppConfig-backed helper (e.g. a deprecated
  `forRootFromAppConfig`) is a planning decision, not an approved requirement.

## Dependencies

- Related to TASK-006 (pretty flag). Must remain consistent.
- No new third-party dependencies expected.

## Assumptions

- **A-01:** Portability/refactor task, not a backlog defect.
- **A-02:** `buildPinoRootOptions` stays the pure formatting boundary.
- **A-03:** A single logger-options token is sufficient for all consumers per
  entrypoint.
- **A-04:** Parent agent updates `docs/agent-tasks/INDEX.md`.

## Out of scope

- Changing log schema, redaction, or request-context semantics.
- Bringing Migrations onto `AppLogger`.
- Removing the deprecated `InfrastructureModule` facade (separate concern).
- The Redis/Mail/Audit/Exceptions -> Logger import edges beyond making them work
  with the new options-based Logger (structural decoupling of those specific
  imports may be refined during planning but must not break DI).
- Any HTTP/OpenAPI change.

## Acceptance criteria

- **AC-01:** `LoggerModule.forRoot({ level, pretty })` and
  `LoggerModule.forRootAsync({ useFactory, inject?, imports? })` exist and compile,
  producing a working `AppLogger`.
- **AC-02:** `AppLogger` no longer imports or injects `AppConfigService`;
  `LoggerModule` no longer imports `InfrastructureConfigModule` in its portable path
  (verified in the diff).
- **AC-03:** A module spec boots `LoggerModule` with explicit options **without**
  importing `InfrastructureConfigModule` / providing `AppConfigService`, and
  resolves `AppLogger`.
- **AC-04:** API, Worker and Cron still bootstrap and log; pretty in
  `NODE_ENV=development`, JSON otherwise (TASK-006 behavior preserved).
- **AC-05:** `LOGGER_LEVEL` still filters messages in both modes.
- **AC-06:** Request-context fields remain present in log output.
- **AC-07:** `npm run build`, `npm run lint`, `npm run test:unit` and
  `npm run test:module` succeed.
- **AC-08:** No OpenAPI schema/decorator/generated-document changes in the diff.

## Verification strategy

- Static: inspect `LoggerModule`, `AppLogger`, composition roots, and the
  `InfrastructureModule` facade for removed AppConfig coupling and correct option
  wiring.
- DI: run `npm run test:module` (add/adjust a Logger module spec per AC-03).
- Runtime: boot API (spot-check Worker/Cron) in development and production-like
  `NODE_ENV` and confirm pretty/JSON.
- Commands: `npm run build`, `npm run lint`, `npm run test:unit`,
  `npm run test:module`.
- Do not treat documentation as proof of runtime behavior.

## Rollout and rollback

- **Rollout:** Backward-compatible; composition roots updated in the same task.
- **Rollback:** Revert the logger/config/composition commit; no data impact.
- **Risk:** Misconfigured options factory could disable pretty or change level;
  mitigate with the module spec and dev/prod boot checks.

## Open questions requiring human decision

1. Keep a deprecated `LoggerModule.forRootFromAppConfig` for one migration window,
   or cut over composition roots directly?
2. Should `RedisModule`/`MailModule`/`AuditModule`/`ExceptionsModule` receive the
   logger via `imports` passthrough only (composition-root-owned Logger), or keep
   importing `LoggerModule` internally with options forwarded?
3. Exact options shape — minimal `{ level, pretty }` now, or a broader
   `LoggerModuleOptions` (e.g. redaction, base fields) to future-proof?
