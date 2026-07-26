---
task_id: TASK-011
task_type: technical
status: approved
owner: human-approval-required
---

# TASK-011 — ExceptionsModule AppLogger peer + deprecated facade hygiene

## Original request

«Створи на це виправлення задачу» — referring to two Low findings from
`docs/agent-reports/full-review-2026-07-26.md`:

1. `ExceptionsModule` is a static `@Module` that registers `GlobalExceptionFilter`,
   which injects `AppLogger`, but the module does not declare/import `LoggerModule`.
   The API works only because `ApiModule` registers global `LoggerModule` first;
   portable/isolated use fails DI.
2. Deprecated facades remain as copy-paste footguns:
   `*Module.forRootFromAppConfig()` on Redis/Drizzle/BullMQ/Auth/Mail/Storage and
   `InfrastructureModule.forRoot()` (full stack + sample handlers). Docs already
   warn; real entrypoints use explicit composition. Need a cleanup / explicit peer /
   migration-window decision.

## Problem or opportunity

**ExceptionsModule peer (confirmed in code):**

- `libs/infrastructure/src/exceptions/exceptions.module.ts` is a static `@Module`
  that only registers `APP_FILTER` → `GlobalExceptionFilter`.
- `GlobalExceptionFilter` constructor injects `AppLogger` from
  `../logger/app-logger.service`.
- `ExceptionsModule` does not import `LoggerModule` or accept peer `imports`.
- `LoggerModule` is registered `global: true` via `forRoot` / `forRootAsync`.
- `apps/api/src/api.module.ts` imports `loggerModule` then `ExceptionsModule`, so
  production API DI succeeds via the global provider — not via an explicit module
  edge. Worker and Cron do not import `ExceptionsModule` (API-only today).
- Docs (`docs/infrastructure-modules/EXTRACTION_GUIDE.md`, README matrix) already
  list `LoggerModule` as a peer of `ExceptionsModule`, but the module registration
  does not enforce that peer. Isolated Nest testing / extraction therefore risks
  `Nest can't resolve dependencies of the GlobalExceptionFilter (AppLogger, ...)`.

This is composition hygiene / module portability, not a Critical production outage
in the current starter wiring. It is **not** a `docs/agent-backlog/` P0/P1/P2
defect; classify as a new technical task.

**Deprecated facades (confirmed in code):**

- `@deprecated` `forRootFromAppConfig()` exists on:
  `RedisModule`, `DrizzleModule`, `InfrastructureBullMqModule`, `AuthModule`,
  `MailModule`, `StorageModule`.
- `@deprecated` `InfrastructureModule.forRoot()` aggregates config, logger, redis,
  drizzle, bullmq queues, cache, exceptions, mail, storage, transactions, outbox
  (with sample `UserRegisteredEventHandler`), rate limiter, locks, idempotency,
  repositories, auth, and health.
- Grep of `*.ts` / docs shows **no production entrypoint callers** of
  `forRootFromAppConfig` or `InfrastructureModule.forRoot()` — only definitions,
  JSDoc, and documentation warnings (`README.md`, `EXTRACTION_GUIDE.md`, review).
- Real composition roots (`ApiModule`, `WorkerModule`, `CronModule`) already use
  explicit `forRootAsync` / `register*` + `mapAppConfigTo*`.

**Human decision (2026-07-26):** Open question 1 → **Option B** — remove
deprecated `forRootFromAppConfig` and `InfrastructureModule.forRoot` in this task
(together with the Exceptions peer fix). Options A and C are rejected for this
task. Remaining open items: peer API shape (Q2), negative DI test in CI (Q3),
and whether to delete vs stub `InfrastructureModule` (Q4).

## Goal

Make `ExceptionsModule`'s dependency on `AppLogger` / `LoggerModule` **explicit in
module registration** (and keep docs aligned), so isolated reuse and tests fail
loudly only when the peer is missing — not silently rely on import order of a
global logger.

Separately, apply the **human-chosen** disposition for deprecated
`forRootFromAppConfig` / `InfrastructureModule.forRoot` (remove, keep with
softened warnings, or defer to a follow-up task) without inventing a product
behavior change for Auth/Mail/Storage/etc.

No HTTP endpoint contract changes. No database migrations.

## Users and actors

- Integrators extracting or copying `ExceptionsModule` into another Nest app.
- Maintainers writing module specs / composition roots for the API.
- Developers who might copy-paste deprecated `forRootFromAppConfig` or
  `InfrastructureModule.forRoot` from old examples.
- Operators of API / Worker / Cron (runtime behavior of existing entrypoints must
  remain equivalent unless a chosen facade removal breaks intentional legacy use —
  none found in-repo).

## Current system context

Inspected on the current branch:

| Area                    | Evidence                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exceptions registration | `exceptions.module.ts` — static `@Module`, `APP_FILTER` → `GlobalExceptionFilter`                                                                   |
| Filter DI               | `global-exception.filter.ts` — `constructor(private readonly logger: AppLogger)`                                                                    |
| Logger                  | `logger.module.ts` — `global: true` on `forRoot` / `forRootAsync`; exports `AppLogger`                                                              |
| API composition         | `api.module.ts` — `imports: [loggerModule, ExceptionsModule, ...]`                                                                                  |
| Worker / Cron           | Import `LoggerModule`; do **not** import `ExceptionsModule`                                                                                         |
| Facade                  | `infrastructure.module.ts` — `@deprecated` class + `forRoot()` full stack + sample handler                                                          |
| AppConfig bridges       | `*forRootFromAppConfig` on redis/drizzle/bullmq/auth/mail/storage modules                                                                           |
| Docs                    | `docs/infrastructure-modules/README.md` (matrix + Deprecated facade section); `EXTRACTION_GUIDE.md` Exceptions + InfrastructureModule sections      |
| Review                  | `docs/agent-reports/full-review-2026-07-26.md` Low findings (Exceptions peer; deprecated facades)                                                   |
| Prior related work      | TASK-007 made `LoggerModule` portable/global; TASK-010 documented peers including Exceptions → Logger; neither made Exceptions peer import explicit |

Existing peer pattern elsewhere: `IdempotencyModule.register({ imports })`,
`RateLimiterModule.register*({ imports })` — explicit optional/required imports at
registration time. Planner may choose `ExceptionsModule.register({ imports })` or
an equivalent explicit import of an already-registered logger module, subject to
Open question 2.

## Functional requirements

### Core (in scope regardless of facade decision)

- **FR-01:** `ExceptionsModule` must declare its `AppLogger` peer explicitly in its
  Nest module registration (for example by importing a caller-supplied
  `LoggerModule` dynamic module via `register({ imports })`, or another mechanism
  that does not rely solely on ambient global registration from a sibling import
  order). Exact API shape is a planning decision after Open question 2 is answered.
- **FR-02:** Bootstrapping `ExceptionsModule` (or its chosen registration API)
  **without** a registered `AppLogger` / `LoggerModule` peer must fail DI in a
  Nest testing module (observable failure), not succeed by accident.
- **FR-03:** Bootstrapping `ExceptionsModule` **with** an explicit `LoggerModule`
  peer (as used by the API composition root) must succeed and keep
  `GlobalExceptionFilter` registered as `APP_FILTER`.
- **FR-04:** `apps/api/src/api.module.ts` must continue to register the global
  exception filter with working `AppLogger` injection after the change (adjust
  composition only as needed for the chosen API).
- **FR-05:** Exception → HTTP status / error body mapping behavior of
  `GlobalExceptionFilter` must remain unchanged (status codes, `success: false`,
  `error.code` / `message` / `details` shapes for domain and HTTP exceptions).
- **FR-06:** Documentation that describes `ExceptionsModule` peers and registration
  (`docs/infrastructure-modules/README.md`, `EXTRACTION_GUIDE.md`, and any
  EXAMPLES/README snippets that show `ExceptionsModule` usage) must state the
  explicit peer requirement and match the implemented registration API.
- **FR-07:** This task must **not** add, remove, or change any HTTP endpoint,
  request/response DTO, status code contract, auth header/cookie contract, or
  generated OpenAPI document contents beyond incidental regeneration with no
  intentional schema drift.
- **FR-08:** This task must **not** introduce or alter database schemas or
  migration files.

### Facade disposition (Option B — human-approved 2026-07-26)

- **FR-09:** Remove `forRootFromAppConfig` from Redis, Drizzle, BullMQ, Auth,
  Mail, and Storage modules, and remove or gut `InfrastructureModule.forRoot`
  (exact delete-vs-stub for the `InfrastructureModule` class is Open question 4).
  Update all docs/examples that reference those APIs. No in-repo production
  caller may remain broken; update any remaining references.
- ~~FR-09A / FR-09C~~ — not in scope (Options A and C rejected).

## Non-functional requirements

- **NFR-01:** Preserve independent deployability of API, Worker, Cron, and
  Migrations entrypoints; do not pull HTTP exception filter into Worker/Cron
  unless explicitly required (current state: API-only).
- **NFR-02:** Align with `.cursor/rules/20-module-portability.mdc` — do not hide
  required peer dependencies behind unrelated global modules alone.
- **NFR-03:** Prefer local, backward-compatible composition changes; do not
  rewrite unrelated infrastructure modules.
- **NFR-04:** Do not silence DI failures with `any`, `@ts-ignore`, or disabled
  lint rules.
- **NFR-05:** Build/lint/unit (and module specs where added) must pass for
  changed surfaces; record commands and results in the implementation report.

## Public API and interface impact

- **HTTP / OpenAPI:** No intentional public HTTP API or OpenAPI schema changes.
  State explicitly: no endpoint additions or contract changes are expected.
- **Nest module public registration:** `ExceptionsModule` registration API will
  change or gain an explicit peer path (breaking for callers that currently import
  the static module alone without a logger peer — intentional for portability).
- **Deprecated facades:** Public surface **breaking change** under chosen Option B
  (removal of `forRootFromAppConfig` and `InfrastructureModule.forRoot`).

## Data model and migration impact

None. No schema or migration changes.

## Events, queues and background processing

None required. Do not change Outbox, BullMQ queue registration, or sample event
handlers except insofar as Option B removes `InfrastructureModule.forRoot`’s
baked-in sample handler registration with the facade itself.

## Security and authorization

No authz model changes. Exception filter must continue to avoid leaking internal
exception details for unexpected errors (existing `INTERNAL_SERVER_ERROR` message
behavior preserved — FR-05).

## Entrypoints and deployment impact

| Entrypoint | Impact                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| API        | Must update composition if `ExceptionsModule` registration API changes (FR-04).           |
| Worker     | No `ExceptionsModule` today; no required change unless planner discovers a hidden import. |
| Cron       | Same as Worker.                                                                           |
| Migrations | Unaffected.                                                                               |

No new deployables. No env var contract changes for the core Exceptions work.
Facade Option B/C must not require new secrets.

## Observability and operations

- Unexpected errors must still be logged via `AppLogger.error` in
  `GlobalExceptionFilter` when the peer is correctly wired (FR-05).
- Option C may add a runtime deprecation warning when deprecated facades are
  called; such warnings must not break bootstrap of explicit composition roots
  that do not call those APIs.

## Compatibility requirements

- Existing API exception responses remain compatible (FR-05, FR-07).
- Integrators who already register `LoggerModule` globally before
  `ExceptionsModule` should keep working after an explicit peer wiring update at
  the composition root.
- Callers of deprecated facades (if any outside this repo) are affected only under
  Option B (hard break) or Option C (warn). Option A is fully facade-compatible.

## Dependencies

- Depends on current `LoggerModule.forRoot` / `forRootAsync` (TASK-007) remaining
  the source of `AppLogger`.
- Docs baselines from TASK-010 (`EXTRACTION_GUIDE`, infrastructure README) must be
  updated for Exceptions peer accuracy; do not reverse TASK-010 guidance.
- Does **not** depend on backlog bugfix IDs; not a substitute for P0/P1/P2 work.
- Unrelated Low finding (rate-limit key / `req.ip` behind proxy) is **out of
  scope** (separate task if pursued).

## Assumptions

- Current API production wiring works because `LoggerModule` is `global: true` and
  imported before `ExceptionsModule`; the defect is portability/hygiene, not a
  live API outage under normal starter composition.
- There are no in-repo production callers of `forRootFromAppConfig` or
  `InfrastructureModule.forRoot()` (verified by repository search at specification
  time); external forks may still call them.
- Worker/Cron intentionally omit `ExceptionsModule` because they are not HTTP
  servers; this task should not add the filter there without a separate decision.
- Human chose **Option B** (2026-07-26); implementer must not switch to A/C or
  invent a fourth disposition.
- Exact Nest API (`register` vs static imports vs other) for Exceptions peer is
  left to planning after Open question 2 — not prescribed as a single approved
  design here.

## Out of scope

- Changing exception → status mapping rules or error JSON shape.
- Moving `GlobalExceptionFilter` to a different package or replacing `AppLogger`
  with Nest `Logger`.
- Rate-limiter `req.ip` / trust-proxy Low finding.
- Broader removal of `InfrastructureConfigModule` global usage.
- Extracting modules into separate npm packages.
- Archive distribution / publishing work from TASK-010.
- New HTTP endpoints, Auth/session behavior, or OpenAPI feature work.
- Database migrations and env schema redesign.
- Approving or implementing this task (specification only).

## Acceptance criteria

### Core

- **AC-01:** `ExceptionsModule` (or its documented registration API) no longer
  depends solely on ambient global `AppLogger` without an explicit peer wiring
  path described in code and docs (FR-01, FR-06).
- **AC-02:** A targeted Nest testing-module (or equivalent module spec) proves
  that registering Exceptions **with** `LoggerModule.forRoot` / `forRootAsync`
  (or the documented peer) compiles and resolves `GlobalExceptionFilter` /
  `AppLogger` (FR-03).
- **AC-03:** The same style of test (or documented negative check) shows that
  registering Exceptions **without** the logger peer fails DI (FR-02).
- **AC-04:** `ApiModule` still imports/registers Exceptions + Logger such that API
  bootstrap DI for the filter succeeds; filter mapping behavior unchanged vs
  current behavior for representative exception types (FR-04, FR-05) — verified by
  unit/module test and/or static comparison of `global-exception.filter.ts`.
- **AC-05:** `docs/infrastructure-modules/README.md` and `EXTRACTION_GUIDE.md`
  Exceptions sections match the implemented registration API and peer list
  (FR-06).
- **AC-06:** No intentional OpenAPI/HTTP contract drift; no migration files added
  or changed (FR-07, FR-08).
- **AC-07:** `npm run build` (or at least `npm run build:api` plus affected lib
  compilation) and `npm run lint` succeed for the change set; relevant unit/module
  tests for Exceptions (and facade changes if any) pass. Commands and results
  recorded.

### Facade removal (Option B)

- **AC-08:** `forRootFromAppConfig` and `InfrastructureModule.forRoot` are gone
  (or non-callable per Q4 stub policy), docs/examples updated, and repo search
  shows no remaining callers or contradictory “how to use facade” guidance.

## Verification strategy

- **Static:** Diff `exceptions.module.ts`, `global-exception.filter.ts`,
  `api.module.ts`, infrastructure README / EXTRACTION_GUIDE; if Option B/C,
  also facade module files and doc references.
- **Module/unit:** Nest testing-module positive and negative DI cases (AC-02,
  AC-03); existing filter unit coverage if present, or focused mapping assertions
  for FR-05.
- **Build/lint:** `npm run build` (preferred for shared infrastructure) and
  `npm run lint`; run `npm run test:unit` and/or `npm run test:module` for new
  specs.
- **Runtime (optional but recommended):** Brief API bootstrap smoke if local
  infra available — confirm app starts; missing PostgreSQL/Redis is not a code
  defect.
- **OpenAPI:** Confirm no endpoint/schema task scope; skip drift test unless an
  unexpected OpenAPI file change appears in the diff.
- **Do not** mark AC complete from docs-only inspection when DI evidence is
  required (AC-02, AC-03).

## Rollout and rollback

- **Rollout:** Normal code merge; no migration job; no feature flag required for
  core Exceptions peer wiring.
- **Rollback:** Revert the commit(s). Option B is the highest external break risk
  for out-of-repo copy-pasters; Option A/C are lower risk.
- **Communication:** If Option B, call out breaking removal of deprecated APIs in
  release/notes or EXAMPLES changelog style docs updated in the same task.

## Open questions requiring human decision

1. ~~**Facade disposition**~~ — **Resolved: Option B** (2026-07-26). Remove
   deprecated `forRootFromAppConfig` and `InfrastructureModule.forRoot` in this
   task. Breaking for any external callers that still use those APIs.

2. **Exceptions peer API shape:** Prefer
   `ExceptionsModule.register({ imports: [loggerModule] })` (aligned with
   Idempotency/RateLimiter), a static `@Module({ imports: [LoggerModule] })`
   (weaker once Logger is options-based/global), or another documented pattern?
   (Planner proposes after this answer; do not treat any one shape as approved
   until plan approval.)

3. Should a **negative** DI test (AC-03) be required in CI, or is a documented
   manual/module-spec assertion sufficient?

4. **`InfrastructureModule` after Option B:** delete the class/file entirely, or
   leave a stub that throws / documents migration to explicit imports?
