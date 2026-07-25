# TASK-009 — Independent verification

## Verdict

approved

Both the specification and the implementation plan frontmatter are now
`status: approved`. Independent inspection of the production/test diff and
command evidence confirms the implementation matches the approved plan and
satisfies every TASK-009 acceptance criterion. The prior `changes-required`
result (plan still `proposed`) is resolved.

One pre-existing, unrelated `apps/cron/src/cron.module.spec.ts` failure remains
in the full `test:module` run (BullMQ/ioredis mock interop). Cron has no local
changes and imports none of the TASK-009 files; all TASK-009 module/unit specs
pass. This does not block approval of TASK-009.

## Approved specification

- File: `docs/agent-tasks/TASK-009-events-module-handler-injection.md`
- Frontmatter: `status: approved` — **confirmed.**
- INDEX row: `docs/agent-tasks/INDEX.md` lists TASK-009 as `approved`.
- Type: `refactor`. Goal: make `EventsModule` accept domain-event handlers as
  composition-root configuration; remove baked-in `UserRegisteredEventHandler`
  from infrastructure defaults; preserve `user.registered -> welcome email` via
  composition-root wiring; no HTTP/OpenAPI change.

## Approved plan

- File: `docs/agent-plans/TASK-009-events-module-handler-injection.md`
- Frontmatter: `status: approved` — **confirmed** (governance gate that blocked
  the prior verification is cleared).
- Key approved decisions reflected in code:
  1. `handlers?: Type<IDomainEventHandler>[]` on `EventsModule.register`
  2. Single authoritative handler list (no merging/auto-discovery)
  3. Router no-op when zero handlers configured; throw when configured-but-no-match
  4. Sample handler relocated to `events/examples/`
  5. `OutboxProcessorModule` optional `features.eventHandlers`
  6. Register sample handler at Worker + deprecated `InfrastructureModule` facade
     only (not API — runtime-accurate per plan open question #1)

## Scope checked

- Exactly one task implemented: TASK-009.
- Production/test diff confined to Events, Outbox processor module, Worker, and
  deprecated Infrastructure facade (+ their specs).
- Unrelated untracked docs (`TASK-010-*`) ignored; not mixed into production
  diff.
- No HTTP/OpenAPI/controller/DTO changes (AC-08).
- No contracts/token symbol changes (FR-06).
- No acceptance criterion removed or weakened.
- Documented plan deviation vs. spec entrypoint table (API registration):
  intentional, approved in plan body; API does not run the outbox processor.

## Actual changed files

Production:

- `libs/infrastructure/src/events/events.module.ts` — configurable `handlers?`;
  baked-in `UserRegisteredEventHandler` removed.
- `libs/infrastructure/src/events/domain-event.router.ts` — zero-handler no-op.
- `libs/infrastructure/src/events/examples/user-registered.handler.ts` — renamed
  from `events/handlers/user-registered.handler.ts` (0-line content change);
  empty `handlers/` directory removed from working tree.
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` — optional
  `features?: { eventHandlers? }` forwarded into `EventsModule.register`.
- `apps/worker/src/worker.module.ts` — registers
  `{ eventHandlers: [UserRegisteredEventHandler] }`.
- `libs/infrastructure/src/infrastructure.module.ts` — same facade registration.

Tests:

- `libs/infrastructure/src/events/events.module.spec.ts` — AC-02, AC-03.
- `libs/infrastructure/src/events/examples/user-registered.handler.spec.ts` —
  AC-04 unit.
- `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` — AC-04
  wiring + AC-05 default (no features).

Docs (governance / reports, not production):

- Spec, plan, implementation report, this verification report, INDEX updates.

## Requirements matrix

| Requirement | Evidence | Result |
| ----------- | -------- | ------ |
| FR-01 EventsModule accepts handlers as config | `events.module.ts`: `handlers?: Type<IDomainEventHandler>[]`; providers spread + factory `inject: handlers` | passed |
| FR-02 empty handlers => valid `[]` + router routes without error | `events.module.spec.ts` empty-handler case; router early-return when `handlers.length === 0` | passed |
| FR-03 handler registered by composition root | Worker + `InfrastructureModule` facade pass `{ eventHandlers: [UserRegisteredEventHandler] }` (API intentionally unchanged per approved plan) | passed |
| FR-04 OutboxProcessorModule does not force sample handler | Default `forRoot`/`forRootAsync` with no `features` => `handlers: undefined` => `[]`; AC-05 module spec | passed |
| FR-05 welcome-email behavior preserved via composition wiring | Handler unit spec + outbox wiring spec assert `QUEUES.EMAIL` / `send-welcome-email` / `WELCOME` enqueue | passed |
| FR-06 tokens / `IDomainEventHandler` unchanged | `libs/contracts` not in production diff; symbols unchanged | passed |
| FR-07 OpenAPI/HTTP unaffected | No controller/DTO/OpenAPI files in `git diff --name-only` for apps/libs | passed |
| NFR-01 no business logic in events defaults | `events.module.ts` / `domain-event.router.ts` have no User/welcome references; handler under `events/examples/` | passed |
| NFR-02 no circular deps Events/Outbox/Mail | Outbox still imports Events; handler depends on QueueGateway via connectionImports; no new reverse imports | passed |
| NFR-03 token symbols + configured-but-no-match throw preserved | Tokens unchanged; router still throws when handlers configured but none match | passed |

## Acceptance criteria matrix

| AC | Evidence | Result |
| -- | -------- | ------ |
| AC-01 no baked-in default handler | Diff removes `UserRegisteredEventHandler` from `events.module.ts`; no User/welcome references remain in that file | passed |
| AC-02 empty-handler routes unknown without throw | `events.module.spec.ts` — executed, pass | passed |
| AC-03 caller-supplied handler receives event | `events.module.spec.ts` RecordingHandler case — executed, pass | passed |
| AC-04 user.registered still enqueues welcome email | Handler unit spec + outbox `forRoot(..., { eventHandlers: [...] })` wiring spec — both executed, pass; Worker/facade wire the handler | passed |
| AC-05 Outbox without forcing sample handler | outbox spec default (no `features`) compiles, routes as no-op, no enqueue — executed, pass | passed |
| AC-06 no business logic under generic events defaults | Handler at `events/examples/`; `handlers/` gone; generic module/router free of sample business | passed |
| AC-07 build, lint, test:unit, test:module | See Commands executed. build/lint/unit pass; all TASK-009 module specs pass; aggregate `test:module` exits 1 solely due to pre-existing unrelated cron suite | passed |
| AC-08 no OpenAPI changes | `git diff --name-only` apps/libs — only events/outbox/worker/facade (+ specs) | passed |

## Architecture and DI verification

- **EventsModule:** optional `handlers` config; registers handler classes as
  providers; `TOKENS.DomainEventHandlers` factory injects exactly those classes
  (empty => `[]`); exports only `TOKENS.DomainEventRouter` (unchanged).
- **DomainEventRouter:** no-op when `this.handlers.length === 0`; otherwise
  filter by `supports`, throw if none match, then sequential `handle` (ordering
  preserved). Optional debug log from plan not required (plan said optional).
- **OutboxProcessorModule:** `features?.eventHandlers` threaded through
  `buildFeatureImports` into `EventsModule.register`. Default remains zero
  handlers.
- **Worker:** sole production entrypoint that runs the outbox processor; passes
  `[UserRegisteredEventHandler]` from `events/examples/`.
- **InfrastructureModule facade:** same registration for deprecated-facade
  parity.
- **API / Cron:** unchanged; Cron does not execute handlers; API does not import
  OutboxProcessorModule.
- **Contracts:** no changes.
- **Dependency direction:** preserved; example handler remains in infrastructure
  (required so the facade can import it without depending on `apps`).

## Database and migration verification

N/A — no schema or migration changes.

## Security verification

N/A for new attack surface. Relocated handler retains identical
`TOKENS.QueueGateway` / `QUEUES.EMAIL` access; no broader permissions granted.

## Commands executed

Command: `node node_modules/@nestjs/cli/bin/nest.js build api` (+ worker, cron, migrations sequentially)
Result: exit 0 for all four targets
Conclusion: shared infrastructure and Worker composition compile with the new handler wiring. (Per-target nest CLI used to avoid intermittent Windows npm-wrapper crashes documented in P2-08/P2-11; equivalent to `npm run build` constituents.)

Command: `npm run lint`
Result: exit 0 (`eslint . --max-warnings=0`)
Conclusion: no lint errors or warnings.

Command: `node node_modules/jest/bin/jest.js --config jest.unit.config.ts`
Result: exit 0 — `Test Suites: 37 passed`, `Tests: 212 passed`
Conclusion: unit suite including the new handler unit spec passes. (Pre-existing Nest ERROR console noise from unrelated guard/health error-path tests; suites still pass.)

Command: `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/events/examples/user-registered.handler.spec.ts`
Result: exit 0 — `Test Suites: 1 passed`, `Tests: 2 passed`
Conclusion: AC-04 unit coverage for welcome-email enqueue passes.

Command: `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand libs/infrastructure/src/events/events.module.spec.ts libs/infrastructure/src/outbox/outbox-processor.module.spec.ts`
Result: exit 0 — `Test Suites: 2 passed`, `Tests: 6 passed`
Conclusion: AC-02, AC-03, AC-04 wiring, AC-05 all pass under DI bootstrap.

Command: `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand`
Result: exit 1 — `Test Suites: 1 failed, 12 passed`; `Tests: 1 failed, 27 passed`. Sole failure: `apps/cron/src/cron.module.spec.ts` (`ioredis_1.default is not a constructor` / BullMQ mock interop). File has no local changes; Cron imports none of the TASK-009 changed files.
Conclusion: TASK-009 module specs are green. Aggregate AC-07 `test:module` non-zero exit is a pre-existing unrelated defect, not introduced by this task.

Command: `git diff --name-only HEAD -- apps/ libs/`
Result: nine paths under events/outbox/worker/facade (+ specs); no OpenAPI/controller/DTO
Conclusion: AC-08 satisfied; scope matches approved plan.

## Findings

1. **Governance gate cleared (prior blocker).** Plan frontmatter is now
   `status: approved`. Spec and INDEX also `approved`. Prior verification's
   `changes-required` reason no longer applies.
2. **Implementation matches approved plan.** Configurable Events handlers,
   router zero-handler no-op, Outbox `features.eventHandlers`, handler under
   `events/examples/`, Worker + facade wiring — all present and tested.
3. **Pre-existing unrelated cron module-spec failure.** Does not implicate
   TASK-009; recorded under Remaining risks for follow-up outside this task.
4. **README path drift (low, out of plan scope).** `README.md` still cites
   `libs/infrastructure/src/events/handlers/user-registered.handler.ts`. Not in
   the approved plan file list; recommend a follow-up doc touch.

## Documentation alignment

- Spec / plan / INDEX: consistent and approved.
- Implementation report accurately describes the diff (plan status claim now
  matches frontmatter).
- Canonical README still has the old handler path (out-of-scope doc drift).

## Remaining risks

- **R-1 (low):** Future outbox consumers that omit `features.eventHandlers` will
  silently no-op domain events (by design). Mitigated by Worker/facade wiring
  and AC-05/AC-04 specs.
- **R-2 (low):** Zero-configured-handlers no-op can mark events processed without
  side effects in a zero-handler deployment (approved plan decision #3).
- **R-3 (doc, low):** README still references the pre-move handler path.
- **R-4 (env, unrelated):** `cron.module.spec.ts` fails on this host due to
  BullMQ/ioredis mock interop; track separately from TASK-009.

## Unverified areas

- Live Worker + PostgreSQL + Redis end-to-end outbox drain was not run; AC-04 is
  covered by unit + DI wiring specs with mocked `QueueGateway`, consistent with
  the approved plan (live run optional / infra-gated).
- `npm run test:release` and `npm run test:int` not required by the plan; not
  executed.
- Aggregate `test:module` green status cannot be claimed while the unrelated cron
  suite fails in this environment.
