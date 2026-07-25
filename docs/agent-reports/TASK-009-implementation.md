# TASK-009 — Implementation report

## Verdict

implemented

(One pre-existing, unrelated module-test failure remains — see Command results and
Unverified areas. It is not introduced by this task.)

## Approved specification

`docs/agent-tasks/TASK-009-events-module-handler-injection.md` (frontmatter
`status: approved`).

Summary: make `EventsModule`'s domain-event handler set composition-root configuration
instead of hard-registering `UserRegisteredEventHandler` (welcome-email business) as the
sole `TOKENS.DomainEventHandlers`. The generic Events/Outbox infrastructure must contain
no starter business handler by default, while the starter's observable
`user.registered -> welcome email` behavior is preserved end to end via composition-root
wiring. No HTTP/OpenAPI change.

## Approved plan

`docs/agent-plans/TASK-009-events-module-handler-injection.md` (frontmatter
`status: approved`). Implemented in the approved phase order (Phases 1–7).

## Changed files

Production code:

- `libs/infrastructure/src/events/examples/user-registered.handler.ts` — **added**
  (relocated from `handlers/`, class `UserRegisteredEventHandler` unchanged).
- `libs/infrastructure/src/events/handlers/user-registered.handler.ts` — **deleted**
  (moved; empty `handlers/` directory removed).
- `libs/infrastructure/src/events/events.module.ts` — **modified** (handler-configurable
  `register`; removed baked-in handler default).
- `libs/infrastructure/src/events/domain-event.router.ts` — **modified**
  (zero-configured-handlers no-op).
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` — **modified** (optional
  `features.eventHandlers` threaded into `EventsModule.register`).
- `apps/worker/src/worker.module.ts` — **modified** (registers the sample handler).
- `libs/infrastructure/src/infrastructure.module.ts` — **modified** (deprecated facade
  registers the sample handler).

Tests:

- `libs/infrastructure/src/events/events.module.spec.ts` — **added** (AC-02, AC-03).
- `libs/infrastructure/src/events/examples/user-registered.handler.spec.ts` — **added**
  (AC-04 unit).
- `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` — **modified**
  (AC-04 wiring + AC-05 default).

Not modified by this task (present in the working tree from the parent/other work):
`docs/agent-tasks/TASK-009-*.md`, `docs/agent-plans/TASK-009-*.md` (pre-staged),
`docs/agent-tasks/TASK-010-module-extraction-strategy.md` (untracked, unrelated).
This report (`docs/agent-reports/TASK-009-implementation.md`) is also added.

## Completed phases

- **Phase 1 — Relocate the sample handler.** Moved `user-registered.handler.ts` to
  `events/examples/`; removed the empty `handlers/` directory; verified no stale
  `events/handlers/user-registered` imports remain.
- **Phase 2 — `EventsModule` handler-configurable.** Added optional
  `handlers?: Type<IDomainEventHandler>[]`; removed the `UserRegisteredEventHandler`
  import, provider and default factory; `TOKENS.DomainEventHandlers` is now built from
  the supplied classes (empty => `[]`); kept
  `{ provide: TOKENS.DomainEventRouter, useExisting: DomainEventRouter }` and
  `exports: [TOKENS.DomainEventRouter]`.
- **Phase 3 — Router zero-handler semantics.** `route()` returns early (no-op) when
  `this.handlers.length === 0`; otherwise it still throws
  `No domain event handler registered for <name>` when handlers are configured but none
  `supports` the event; matching-handler ordering preserved.
- **Phase 4 — Thread handlers through `OutboxProcessorModule`.** Added optional
  `features?: { eventHandlers?: Type<IDomainEventHandler>[] }` to `forRoot` and
  `forRootAsync`; `buildFeatureImports(connectionImports, eventHandlers?)` forwards them
  into `EventsModule.register({ imports, handlers })`. No `features` => zero handlers.
- **Phase 5 — Register the sample handler at composition roots.** Worker
  (`worker.module.ts`) and the deprecated `InfrastructureModule` facade pass
  `{ eventHandlers: [UserRegisteredEventHandler] }`, importing from the `examples` path.
  The API was intentionally left unchanged (it does not run the outbox processor).
- **Phase 6 — Tests.** Added the two new specs and extended the outbox module spec.
- **Phase 7 — Full verification and diff review.** Ran build, lint, unit and module
  tests; reviewed `git diff` to confirm no HTTP/OpenAPI files changed.

## Acceptance criteria self-check

- **AC-01 (no baked-in default handler):** met — `events.module.ts` no longer imports or
  registers `UserRegisteredEventHandler`; handlers come from `options.handlers`.
- **AC-02 (empty-handler module routes unknown event without throwing):** met —
  `events.module.spec.ts` asserts `TOKENS.DomainEventHandlers === []` and
  `route('unknown.event')` resolves without throwing.
- **AC-03 (caller-supplied handler receives matching event):** met —
  `events.module.spec.ts` supplies `RecordingHandler` and asserts it handles the event.
- **AC-04 (`user.registered` still enqueues welcome email):** met — handler unit spec
  asserts `QueueGateway.add(QUEUES.EMAIL, 'send-welcome-email', {template: WELCOME, …},
  {jobId: 'welcome-email:<id>'})`; the outbox wiring spec routes a `user.registered`
  event through `OutboxProcessorModule.forRoot(..., { eventHandlers: [...] })` and
  asserts the same enqueue.
- **AC-05 (outbox compiles/runs without forcing the sample handler):** met — outbox spec
  default (no `features`) case compiles, resolves `TOKENS.OutboxProcessor`, and routing a
  `user.registered` event is a no-op with no enqueue.
- **AC-06 (no business logic under generic `events/` defaults):** met — handler moved to
  `events/examples/`; `events.module.ts`/`domain-event.router.ts` contain no business
  logic.
- **AC-07 (build, lint, test:unit, test:module succeed):** build, lint and test:unit
  pass; test:module passes for all TASK-009 specs. One **pre-existing, unrelated**
  `apps/cron/src/cron.module.spec.ts` failure remains (ioredis/BullMQ mock interop in
  this environment) — see Command results / Unverified areas.
- **AC-08 (no OpenAPI changes in diff):** met — `git diff --name-only` shows no
  controller/DTO/OpenAPI files changed.

## Contract and DI changes

- No changes to `libs/contracts/src/tokens.ts`, `IDomainEventHandler`, or
  `IDomainEventRouter` (FR-06, NFR-03).
- `EventsModule.register` gains optional `handlers?: Type<IDomainEventHandler>[]`;
  `TOKENS.DomainEventHandlers` is provided via a factory with `inject: handlers` that
  returns the injected instances (empty => `[]`). Only `TOKENS.DomainEventRouter` is
  exported (unchanged).
- `OutboxProcessorModule.forRoot`/`forRootAsync` gain an optional second parameter
  `features?: { eventHandlers?: Type<IDomainEventHandler>[] }` forwarded into
  `EventsModule.register`. Existing call sites remain call-compatible.
- Worker and the deprecated facade register `[UserRegisteredEventHandler]` via
  `features.eventHandlers`.

## Database and migration changes

None.

## Commands executed

Run from repo root `e:\Projects\NestJS-Backend-Foundation-Starter`. Jest was invoked via
`node node_modules/jest/bin/jest.js` per AGENTS.md. `npm run build` was executed as its
four constituent `nest build` targets because the Windows npm wrapper crashed
intermittently (exit `-1073741819`), a documented environment issue (P2-08/P2-11); each
target was run to completion successfully.

- `node node_modules/@nestjs/cli/bin/nest.js build api`
- `npm run build:worker` (`nest build worker`)
- `npm run build:cron` (`nest build cron`)
- `npm run build:migrations` (`nest build migrations`)
- `npm run lint`
- `node node_modules/jest/bin/jest.js --config jest.unit.config.ts` (`test:unit`)
- `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand`
  (`test:module`)
- `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand libs/infrastructure/src/outbox/outbox-processor.module.spec.ts libs/infrastructure/src/events/events.module.spec.ts`
  (targeted)
- `git diff --name-only HEAD` / `git diff --stat HEAD` (diff review, AC-08)

## Command results

- `nest build api` — **pass** (exit 0). Conclusion: API project type-checks/compiles.
- `nest build worker` — **pass** (exit 0). Conclusion: Worker compiles with the new
  handler registration.
- `nest build cron` — **pass** (exit 0). Conclusion: Cron unaffected.
- `nest build migrations` — **pass** (exit 0). Conclusion: Migrations unaffected.
- `npm run lint` — **pass** (exit 0, `--max-warnings=0`). Conclusion: no lint errors.
- `test:unit` — **pass**: `Test Suites: 37 passed`, `Tests: 212 passed`. (Pre-existing
  error-path console logs from unrelated guard/health specs; those suites pass.)
- `test:module` — `Test Suites: 1 failed, 12 passed`; `Tests: 1 failed, 27 passed`. The
  only failure is `apps/cron/src/cron.module.spec.ts` (`ioredis_1.default is not a
  constructor`, BullMQ/ioredis mock interop). It reproduces in isolation, the file has no
  local changes, and Cron imports none of the files changed by this task — therefore
  **pre-existing and unrelated** to TASK-009.
- Targeted `outbox-processor.module.spec.ts` + `events.module.spec.ts` — **pass**:
  `Test Suites: 2 passed`, `Tests: 6 passed`. Conclusion: all TASK-009 specs pass
  (AC-02, AC-03, AC-04 unit + wiring, AC-05).
- `git diff --name-only` — **pass**: only events/outbox/worker/facade and their specs
  plus the relocated handler changed; no controller/DTO/OpenAPI files (AC-08).

## Deviations

- **`npm run build` split into per-target `nest build` runs.** The aggregate `npm run
  build` script and some other npm invocations crashed intermittently on this Windows
  host (exit `-1073741819`, a documented wrapper instability). Each of the four
  `nest build` targets composing `npm run build` was executed individually to completion
  (all exit 0), which is behaviorally equivalent. No script contents were changed.
- **Outbox wiring spec uses a `@Global()` mock connection module.** To honor the
  approved plan's `OutboxProcessorModule.forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
  { eventHandlers: [...] })` shape (which threads `[]` connection imports), the existing
  in-file `MockConnectionModule` was marked `@Global()` so `DRIZZLE_DB` and
  `TOKENS.QueueGateway` resolve for the handler and processor. A `beforeEach(() =>
  jest.clearAllMocks())` was added so the shared `QueueGateway.add` mock does not
  accumulate calls across cases. These are test-only adjustments; production wiring is
  unchanged.
- No scope expansion, no contract/token changes, no HTTP/OpenAPI/DTO/controller changes.

## Documentation changes

None to canonical docs beyond this implementation report. `README.md` contains a
descriptive reference to the pre-move path
`libs/infrastructure/src/events/handlers/user-registered.handler.ts`; updating it was not
in the approved plan's file list, so it was intentionally left untouched (see Remaining
risks). `docs/agent-tasks/INDEX.md` was intentionally not modified (spec A-03: parent
agent's responsibility).

## Remaining risks

- **R-1 (low):** The welcome-email side effect is now driven by composition-root wiring
  (Worker + deprecated facade). If a future entrypoint runs the outbox processor without
  passing `features.eventHandlers`, `user.registered` events will be a no-op (no email).
  Mitigated by the outbox wiring spec and explicit registration at both current runtime
  consumers.
- **R-2 (low):** Router no-op on zero configured handlers could mask genuinely unhandled
  events in a zero-handler deployment (events treated as processed). By design per the
  approved plan; the throw is preserved whenever any handler is configured.
- **R-3 (doc drift, low):** `README.md` still references the old handler path; it was
  out of the approved file scope. Recommend a follow-up doc update.

## Unverified areas

- **`apps/cron/src/cron.module.spec.ts`** could not be observed passing in this
  environment; it fails on `ioredis_1.default is not a constructor` independently of this
  task (pre-existing, Cron imports no changed file). Not caused by, and not in scope of,
  TASK-009.
- **Live runtime enqueue** (real Worker + PostgreSQL + Redis draining the outbox) was not
  executed; AC-04 is covered by unit and DI module-wiring specs with a mocked
  `QueueGateway`, consistent with the plan (a live run is gated on available
  infrastructure).
- `npm run test:release` and `npm run test:int` were not run (not required by the plan;
  integration requires PostgreSQL/Redis).
