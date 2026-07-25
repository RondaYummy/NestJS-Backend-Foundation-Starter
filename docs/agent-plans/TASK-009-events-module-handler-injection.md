---
task_id: TASK-009
specification: docs/agent-tasks/TASK-009-events-module-handler-injection.md
status: approved
owner: human-approval-required
---

# TASK-009 — Implementation plan

## Approved specification

`docs/agent-tasks/TASK-009-events-module-handler-injection.md` (frontmatter
`status: approved`).

Summary: `EventsModule` must stop hard-registering `UserRegisteredEventHandler`
(welcome-email business) as the sole `TOKENS.DomainEventHandlers`. Handlers become
composition-root configuration; the generic Events/Outbox infrastructure contains no
starter business handler by default. The starter's observable
`user.registered -> welcome email` behavior must be preserved end to end through
composition-root wiring. No HTTP/OpenAPI change.

## Current implementation

Inspected on the current branch:

- `libs/infrastructure/src/events/events.module.ts` — `register({ imports? })`
  provides `DomainEventRouter`, `UserRegisteredEventHandler`, and a `useFactory` for
  `TOKENS.DomainEventHandlers` that injects `UserRegisteredEventHandler` and returns
  `[userRegistered]`; provides `TOKENS.DomainEventRouter` (`useExisting`
  `DomainEventRouter`); exports `TOKENS.DomainEventRouter`.
- `libs/infrastructure/src/events/domain-event.router.ts` — injects
  `TOKENS.DomainEventHandlers` (`readonly IDomainEventHandler[]`); `route()` filters
  handlers by `supports(event.name)` and **throws**
  `No domain event handler registered for <name>` when zero handlers match.
- `libs/infrastructure/src/events/handlers/user-registered.handler.ts` — injects
  `TOKENS.QueueGateway`, `supports('user.registered')`, enqueues `QUEUES.EMAIL`
  `send-welcome-email` (`EMAIL_TEMPLATE.WELCOME`) with `idempotencyKey`/`jobId` derived
  from the event id.
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` — `buildFeatureImports`
  always adds `AuditModule.register`, `EventsModule.register` (both threaded with the
  same `connectionImports`); consumed by `forRoot` / `forRootAsync`.
- `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts` — injects
  `TOKENS.DomainEventRouter` and calls `domainEventRouter.route(...)` inside
  `publishEvent`. **This is the runtime consumer of handlers.**
- `libs/infrastructure/src/outbox/outbox-processor-options.module.ts` — options built
  by `ConfigurableModuleBuilder` (`forRoot`/`forRootAsync`, `OPTIONS_TYPE`/
  `ASYNC_OPTIONS_TYPE`, `TOKENS.OutboxProcessorOptions`).
- `apps/worker/src/worker.module.ts` — imports `OutboxProcessorModule.forRootAsync({...})`
  with `imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule]`;
  registers `outboxProcessorProvider` which runs `TOKENS.OutboxProcessor`. **The Worker
  is where handlers actually execute today.**
- `apps/cron/src/cron.module.ts` (+ `cron.module.spec.ts`) — asserts it does **not**
  import `DrizzleModule`/`OutboxProcessorModule`; Cron only enqueues outbox work. Cron
  never executes domain-event handlers.
- `apps/api/src/api.module.ts` — does **not** import `OutboxProcessorModule`; the API
  enqueues to `QUEUES.OUTBOX`/`QUEUES.EMAIL` but does not route domain events.
- `libs/infrastructure/src/infrastructure.module.ts` — deprecated facade; imports
  `OutboxProcessorModule.forRootAsync({...})`, so it also executes handlers when used.
- `libs/infrastructure/src/bullmq/bullmq.module.ts` — `registerQueues` exports
  `TOKENS.QueueGateway`; because the Worker/facade thread `bullMqQueuesModule` into
  `connectionImports`, `UserRegisteredEventHandler`'s `TOKENS.QueueGateway` dependency is
  resolvable through the existing import path.
- `libs/contracts/src/tokens.ts` — `DomainEventHandlers`, `DomainEventRouter` symbols.
- `libs/contracts/src/events/domain-event-handler.ts` — `IDomainEventHandler`.
- `libs/contracts/src/events/domain-event-router.ts` — `IDomainEventRouter`,
  `RoutableDomainEvent`.

No existing `events/**/*.spec.ts`. `drizzle-outbox-processor.spec.ts` and
`drizzle-outbox-processor.int-spec.ts` inject a **mocked** `IDomainEventRouter`, so
changing the router's internal wiring does not affect them.
`outbox-processor.module.spec.ts` boots `OutboxProcessorModule.forRootAsync` with a mock
connection module (provides `DRIZZLE_DB` and `TOKENS.QueueGateway`) and asserts token
resolution only (does not route events).

### Runtime-consumer clarification vs. specification entrypoint table

The specification's entrypoint table implies the **API** registers
`UserRegisteredEventHandler`. Runtime evidence contradicts this: the API does not import
`OutboxProcessorModule`, so it never resolves or executes `TOKENS.DomainEventHandlers`.
The handler executes only where the outbox processor runs: the **Worker** and the
**deprecated `InfrastructureModule` facade**. To preserve exact current behavior and
avoid dead wiring, this plan registers the sample handler at the **Worker** and **facade**
composition roots only. See Open questions #1.

## Architecture decision

1. **Handlers become configuration on `EventsModule.register`.** Add an optional
   `handlers?: Type<IDomainEventHandler>[]` to the register options. `EventsModule`
   registers each supplied handler class as a provider and builds
   `TOKENS.DomainEventHandlers` via a factory that injects exactly those classes (empty
   list => `[]`). `EventsModule` no longer imports or references
   `UserRegisteredEventHandler`. Chosen over token-based or factory-returning-instances
   shapes because it mirrors the existing provider/`useFactory` pattern, keeps handler
   dependency resolution inside Nest DI, and needs no new contract types. (Open
   questions #2.)
2. **Single authoritative handler list per registration** (no multi-import merging /
   auto-discovery), matching the spec Out-of-scope. (Open questions #3.)
3. **Router zero-handler semantics.** To satisfy AC-02/FR-02 while preserving safety and
   NFR-03: if **no handlers are configured at all** (`handlers.length === 0`), `route()`
   is a no-op (optionally `debug`-logged) and does not throw. If handlers **are**
   configured but none `supports` the event, `route()` **still throws** as today. This
   keeps the generic infrastructure usable with zero handlers (AC-02) yet preserves the
   existing "unhandled event fails and retries" safety for real deployments that wire
   handlers (NFR-03, current outbox behavior). (Open questions #4.)
4. **Relocate the sample handler out of the generic `events/` surface.** Move
   `user-registered.handler.ts` to `libs/infrastructure/src/events/examples/`. It must
   remain in the `infrastructure` lib (not `apps`) because the deprecated
   `InfrastructureModule` facade — which lives in `infrastructure` — must import it, and
   `infrastructure` may not depend on `apps`. It is registered only via composition
   roots, so no business logic remains in the generic Events defaults (AC-06, NFR-01).
5. **Thread handlers through `OutboxProcessorModule`.** Add an optional second parameter
   `features?: { eventHandlers?: Type<IDomainEventHandler>[] }` to `forRoot` and
   `forRootAsync`. `buildFeatureImports` forwards it as
   `EventsModule.register({ imports: connectionImports, handlers: eventHandlers })`.
   Default (no `features`) => `EventsModule` with zero handlers (AC-05).

## Scope

- Make `EventsModule` handler set configurable; remove baked-in handler default.
- Adjust `DomainEventRouter` zero-handler behavior per decision #3.
- Relocate the sample `UserRegisteredEventHandler` to an `examples` path.
- Add optional `features.eventHandlers` threading to `OutboxProcessorModule`.
- Register the sample handler at the Worker and deprecated-facade composition roots.
- Add module/unit specs for empty-handler, supplied-handler, and welcome-email wiring.

## Out of scope

- Outbox claim/lock/retry/heartbeat semantics.
- Detaching Audit/Logger from the outbox processor (Logger portability is TASK-007).
- Handler auto-discovery/registry or multi-import merging.
- Any HTTP/OpenAPI/DTO/controller change.
- Changing `TOKENS.*` symbols or the `IDomainEventHandler` / `IDomainEventRouter`
  contracts.

## Files to create

- `libs/infrastructure/src/events/examples/user-registered.handler.ts` — relocated
  sample handler (moved from `handlers/`), unchanged behavior.
- `libs/infrastructure/src/events/events.module.spec.ts` — module specs for AC-02, AC-03
  (and empty-handlers `TOKENS.DomainEventHandlers === []`).
- `libs/infrastructure/src/events/examples/user-registered.handler.spec.ts` — unit spec
  for AC-04 (handler enqueues welcome email).

## Files to modify

- `libs/infrastructure/src/events/events.module.ts` — add `handlers?` option; remove
  `UserRegisteredEventHandler` import/providers/default factory; build
  `TOKENS.DomainEventHandlers` from supplied handler classes.
- `libs/infrastructure/src/events/domain-event.router.ts` — zero-configured-handlers
  no-op per decision #3; retain throw when handlers configured but none match.
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` — add optional
  `features?: { eventHandlers?: Type<IDomainEventHandler>[] }` to `forRoot`/
  `forRootAsync`; forward through `buildFeatureImports` into `EventsModule.register`.
- `apps/worker/src/worker.module.ts` — pass
  `{ eventHandlers: [UserRegisteredEventHandler] }` to
  `OutboxProcessorModule.forRootAsync`; import from the new `examples` path.
- `libs/infrastructure/src/infrastructure.module.ts` — same handler registration on its
  `OutboxProcessorModule.forRootAsync` call (facade behavior parity).
- `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` — extend to cover the
  supplied-handler path (AC-04/AC-05) or add a dedicated spec (see Implementation
  phases).
- `docs/agent-tasks/INDEX.md` — flip TASK-009 status column `proposed -> approved` to
  match the approved specification (documentation only; see Open questions #5). *Owner:
  parent agent per spec A-03; listed here for traceability, not implemented by the
  planner.*

## Files to delete

- `libs/infrastructure/src/events/handlers/user-registered.handler.ts` — replaced by the
  relocated file under `events/examples/` (a move, not a behavior deletion). If the
  `handlers/` directory becomes empty, remove it.

## Domain changes

None. No domain entities, value objects, events or errors change.

## Application changes

None. Application use cases are unaffected.

## Contract and DI changes

- No changes to `libs/contracts/src/tokens.ts`, `IDomainEventHandler`, or
  `IDomainEventRouter` (FR-06, NFR-03).
- DI wiring changes are confined to `EventsModule`, `OutboxProcessorModule`, and the two
  composition roots that run the outbox (Worker, facade).
- `TOKENS.DomainEventRouter` remains the only exported Events token.

## Infrastructure changes

- `EventsModule.register` signature:

```ts
type EventsModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
  handlers?: Type<IDomainEventHandler>[];
};
```

  Providers: `DomainEventRouter`, `...(handlers ?? [])`, a factory for
  `TOKENS.DomainEventHandlers` with `inject: handlers ?? []` returning the injected
  instances as an array, and `{ provide: TOKENS.DomainEventRouter, useExisting:
  DomainEventRouter }`. Exports `TOKENS.DomainEventRouter` (unchanged).
- `DomainEventRouter.route`: no-op when `this.handlers.length === 0`; otherwise filter by
  `supports`, throw if configured-but-no-match, then `await handler.handle(event)` for
  each match (ordering preserved).
- `OutboxProcessorModule.forRoot(options, features?)` and
  `forRootAsync(options, features?)`: pass `features?.eventHandlers` into
  `buildFeatureImports(connectionImports, eventHandlers?)`, which calls
  `EventsModule.register({ imports: connectionImports, handlers: eventHandlers })`.

## Interface and entrypoint changes

| Entrypoint | Change |
| ---------- | ------ |
| API (`apps/api/src/api.module.ts`) | **No change.** Does not run the outbox processor; does not execute handlers today. |
| Worker (`apps/worker/src/worker.module.ts`) | Pass `{ eventHandlers: [UserRegisteredEventHandler] }` to `OutboxProcessorModule.forRootAsync`; import handler from `@infrastructure/events/examples/user-registered.handler`. Preserves welcome-email behavior (AC-04, FR-05). |
| Cron (`apps/cron/src/cron.module.ts`) | **No change.** Only enqueues; `cron.module.spec.ts` assertions remain valid. |
| `InfrastructureModule` facade | Pass the same `{ eventHandlers: [UserRegisteredEventHandler] }` to its `OutboxProcessorModule.forRootAsync` to retain behavior when the deprecated facade is used. |

## Database and migration changes

None.

## Security and authorization changes

None. The relocated handler keeps identical access (enqueues to `QUEUES.EMAIL` via
`TOKENS.QueueGateway`); no broader scope is granted.

## Observability changes

- No new metrics.
- Optional `debug` log when `route()` is a no-op due to zero configured handlers (does
  not change existing warn/error outbox logging). Existing outbox audit/log behavior
  unchanged.

## Implementation phases

Each phase lists exact paths, symbols, mapped acceptance criteria and verification.

### Phase 1 — Relocate the sample handler (AC-06, NFR-01)

- Move `libs/infrastructure/src/events/handlers/user-registered.handler.ts` ->
  `libs/infrastructure/src/events/examples/user-registered.handler.ts` (class
  `UserRegisteredEventHandler` unchanged). Remove now-empty `handlers/` dir if empty.
- Verify: `rg "events/handlers/user-registered"` returns no stale imports;
  `npm run build`.

### Phase 2 — Make `EventsModule` handler-configurable (AC-01, AC-02, AC-03, FR-01, FR-02, FR-06)

- Edit `libs/infrastructure/src/events/events.module.ts`: add `handlers?` option; remove
  `UserRegisteredEventHandler` import and its provider/factory; build
  `TOKENS.DomainEventHandlers` from `options.handlers ?? []`; keep router provider/export.
- Verify: `npm run build`; new `events.module.spec.ts` (Phase 6) resolves router with
  empty and supplied handlers.

### Phase 3 — Adjust router zero-handler semantics (AC-02, FR-02, NFR-03)

- Edit `libs/infrastructure/src/events/domain-event.router.ts`: early return when
  `this.handlers.length === 0`; retain existing throw when configured-but-no-match.
- Verify: `events.module.spec.ts` AC-02 case (unknown event, no throw);
  `drizzle-outbox-processor.spec.ts` still passes (router mocked).

### Phase 4 — Thread handlers through `OutboxProcessorModule` (AC-04, AC-05, FR-04)

- Edit `libs/infrastructure/src/outbox/outbox-processor.module.ts`: add optional
  `features?: { eventHandlers?: Type<IDomainEventHandler>[] }` to `forRoot`/
  `forRootAsync`; update `buildFeatureImports` to forward `eventHandlers` into
  `EventsModule.register`.
- Verify: `outbox-processor.module.spec.ts` (existing no-handler case) still compiles
  (AC-05); extended supplied-handler case (Phase 6) routes to the handler.

### Phase 5 — Register the sample handler at composition roots (AC-04, FR-03, FR-05)

- Edit `apps/worker/src/worker.module.ts` and
  `libs/infrastructure/src/infrastructure.module.ts` to pass
  `{ eventHandlers: [UserRegisteredEventHandler] }` and import from the `examples` path.
- Verify: `npm run build:worker`; `npm run build`; module specs (Phase 6).

### Phase 6 — Tests (AC-02, AC-03, AC-04, AC-05, AC-07)

- `libs/infrastructure/src/events/events.module.spec.ts`:
  - boots `EventsModule.register()` (no handlers), asserts `TOKENS.DomainEventHandlers`
    resolves to `[]` and `TOKENS.DomainEventRouter.route({ name: 'unknown', ... })`
    resolves without throwing (AC-02);
  - boots `EventsModule.register({ imports: [FakeDepsModule], handlers: [FakeHandler] })`
    and asserts a matching event reaches `FakeHandler.handle` (AC-03).
- `libs/infrastructure/src/events/examples/user-registered.handler.spec.ts`: unit test
  that `handle()` calls `TOKENS.QueueGateway.add` with `QUEUES.EMAIL`,
  `'send-welcome-email'`, `EMAIL_TEMPLATE.WELCOME` and the derived `jobId` (AC-04, unit).
- Extend `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` (or add
  `events/examples/user-registered.wiring.spec.ts`): boot
  `OutboxProcessorModule.forRoot(OUTBOX_PROCESSOR_DEFAULT_OPTIONS, { eventHandlers:
  [UserRegisteredEventHandler] })` with the existing mock connection module (provides
  `DRIZZLE_DB` + `TOKENS.QueueGateway`), resolve `TOKENS.DomainEventRouter`, route a
  `user.registered` event, and assert `QueueGateway.add` was called for `QUEUES.EMAIL`
  (AC-04, wiring). Also assert the default (no `features`) still compiles (AC-05).
- Verify: `npm run test:unit`, `npm run test:module`.

### Phase 7 — Full verification and diff review (AC-07, AC-08)

- Run full checks (see Full verification), then `git diff` to confirm no
  controller/DTO/OpenAPI files changed (AC-08).

## Dependency and compatibility impact

- No new npm dependencies; `package-lock.json` unchanged.
- Backward-compatible: `TOKENS.*` symbols, `IDomainEventHandler`/`IDomainEventRouter`
  contracts, and observable welcome-email behavior preserved.
- Router behavior change limited to the zero-configured-handlers case (no-op instead of
  throw); the configured-but-no-match case is unchanged.
- `EventsModule.register()` and `OutboxProcessorModule.forRoot*(...)` remain
  call-compatible for existing callers (new params optional).

## Targeted verification

- `rg "UserRegisteredEventHandler|events/handlers/user-registered"` — confirm no
  references to the generic default remain and imports point to `events/examples/`.
- `npm run build` — shared infrastructure/contracts change.
- `node node_modules/jest/bin/jest.js libs/infrastructure/src/events` — Events specs.
- `node node_modules/jest/bin/jest.js libs/infrastructure/src/outbox/outbox-processor.module.spec.ts`
  — outbox wiring.

## Full verification

Record each as command / result / conclusion:

- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm run test:module`
- `git diff --name-only` — confirm no HTTP/OpenAPI/controller/DTO files changed (AC-08).

(Runtime enqueue confirmation of AC-04 is covered by the module wiring spec using a mock
`QueueGateway`; a live Worker/DB run is optional and gated on available infrastructure.)

## Acceptance criteria mapping

| AC | Requirement | Phase | Verification |
| -- | ----------- | ----- | ------------ |
| AC-01 | Events no longer hard-registers the handler default | Phase 2 | Diff of `events.module.ts`; `rg` shows no default handler |
| AC-02 | Empty-handler module routes unknown event without throwing | Phases 2,3,6 | `events.module.spec.ts` empty-handler case |
| AC-03 | Caller-supplied handler receives matching event | Phases 2,6 | `events.module.spec.ts` supplied-handler case |
| AC-04 | `user.registered` still enqueues welcome email via composition wiring | Phases 4,5,6 | handler unit spec + outbox wiring spec (`QueueGateway.add` on `QUEUES.EMAIL`) |
| AC-05 | Outbox compiles/runs without forcing the sample handler | Phases 4,6 | `outbox-processor.module.spec.ts` default (no `features`) case |
| AC-06 | No business logic under generic `events/` defaults | Phase 1 | file relocation to `events/examples/`; diff |
| AC-07 | `build`, `lint`, `test:unit`, `test:module` pass | Phase 7 | Full verification commands |
| AC-08 | No OpenAPI changes in diff | Phase 7 | `git diff --name-only` review |

## Rollout strategy

- Single backward-compatible change set; composition roots updated in the same task so
  observable behavior is unchanged at deploy time. No feature flag or migration needed.

## Rollback strategy

- Revert the commit. No data/schema impact; token symbols and contracts unchanged.

## Risks

- **R-1 (medium):** Misplacing handler registration could stop welcome emails or run the
  handler in the wrong entrypoint. Mitigation: register at the confirmed runtime
  consumers (Worker + facade) and cover with the outbox wiring spec (AC-04).
- **R-2 (medium):** Router no-op-on-empty could mask genuinely unhandled events in a
  zero-handler deployment (events marked processed rather than failed). Mitigation: throw
  is preserved whenever any handler is configured; optional debug log on no-op; behavior
  documented. See Open questions #4.
- **R-3 (low):** `Type<IDomainEventHandler>[]` handler classes with unmet constructor
  dependencies would fail at bootstrap. Mitigation: composition roots thread the same
  `connectionImports` that already export `TOKENS.QueueGateway`; module specs boot the
  wiring.
- **R-4 (low):** Facade parity — forgetting to wire the handler in the deprecated
  `InfrastructureModule` would silently drop welcome emails for facade consumers.
  Mitigation: explicit Phase 5 edit + review.

## Open questions requiring human decision

1. **Handler placement / entrypoint set.** This plan keeps
   `UserRegisteredEventHandler` in the `infrastructure` lib under `events/examples/`
   (required because the deprecated facade in `infrastructure` must import it) and
   registers it at the **Worker + facade** composition roots only — **not** the API,
   because the API does not run the outbox processor (contradicting the spec's
   entrypoint table). Confirm this runtime-accurate placement, or direct an alternative
   (e.g. a dedicated example module, or also wiring the API even though it is dead).
2. **Configuration shape.** Recommended: `handlers?: Type<IDomainEventHandler>[]`
   (provider classes) on `EventsModule.register`. Confirm vs. provider tokens or a
   factory returning `IDomainEventHandler[]`.
3. **Single vs. merged handler sets.** Recommended: one authoritative list per
   registration (no multi-import merging / auto-discovery), per spec Out-of-scope.
   Confirm.
4. **Router zero-handler semantics.** Recommended: no-op only when **zero handlers are
   configured**; keep throwing when handlers are configured but none match. Alternative:
   always no-op on no match (simpler, but silently succeeds unhandled events in
   configured deployments). Confirm the recommended behavior.
5. **INDEX status.** The specification frontmatter is `approved`, but
   `docs/agent-tasks/INDEX.md` still lists TASK-009 as `proposed`. Confirm the parent
   agent should flip the INDEX row to `approved` (spec A-03) — the planner did not modify
   it.
