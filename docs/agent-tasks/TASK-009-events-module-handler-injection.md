---
task_id: TASK-009
task_type: refactor
status: approved
owner: human-approval-required
---

# TASK-009 — EventsModule configurable handlers (remove baked-in UserRegistered business)

## Original request

Створити завдання на всі High-проблеми з рев'ю переносимості
(`docs/agent-reports/full-review-2026-07-20.md`). Ця задача покриває High-проблему:
`EventsModule` жорстко реєструє `UserRegisteredEventHandler` (welcome email) як
єдиний `TOKENS.DomainEventHandlers`, і `OutboxProcessorModule` завжди тягне
`EventsModule` — тому Events/Outbox невіддільні від sample Auth/User бізнесу.

## Problem or opportunity

`EventsModule.register` hard-codes `UserRegisteredEventHandler` and wires it as the
sole `TOKENS.DomainEventHandlers` array. `OutboxProcessorModule.buildFeatureImports`
always imports `EventsModule.register` (plus Audit, Logger). Consequently, reusing
the Outbox/EventBus infrastructure in another project drags in this starter's
"send welcome email on `user.registered`" business rule, which cannot be overridden
without editing infrastructure source. This violates
`.cursor/rules/20-module-portability.mdc` ("absence of concrete business logic",
"no need to edit the module's internal code").

Technical/portability refactor, not a backlog defect. Note: `EMAIL` queue is
registered by API/Worker composition roots (`api.module.ts`), so the sample handler
functionally belongs to the starter's Auth/User example, not to generic events
infrastructure.

## Goal

`EventsModule` accepts the set of domain event handlers as configuration
(composition-root-provided), so the generic `DomainEventRouter` /
`TOKENS.DomainEventHandlers` wiring contains no starter-specific business handler by
default. The sample `UserRegisteredEventHandler` (welcome email) is registered by
the starter's composition root (Auth/User example wiring), not baked into
infrastructure `EventsModule`. `OutboxProcessorModule` no longer forces the sample
handler into every consumer.

## Users and actors

- Integrators reusing the EventBus/Outbox infrastructure without the starter's
  User/welcome-email behavior.
- The starter's own Auth/User example, which still emits `user.registered` and sends
  a welcome email.
- Maintainers of composition roots and the Outbox processor.

## Current system context

Inspected on the current branch:

- `libs/infrastructure/src/events/events.module.ts` — `register({ imports? })`
  provides `DomainEventRouter`, `UserRegisteredEventHandler`, and a factory for
  `TOKENS.DomainEventHandlers` returning `[userRegistered]`; provides
  `TOKENS.DomainEventRouter` (useExisting `DomainEventRouter`); exports
  `TOKENS.DomainEventRouter`.
- `libs/infrastructure/src/events/handlers/user-registered.handler.ts` — injects
  `TOKENS.QueueGateway`, supports `user.registered`, enqueues `QUEUES.EMAIL`
  `send-welcome-email` (`EMAIL_TEMPLATE.WELCOME`).
- `libs/infrastructure/src/events/domain-event.router.ts` — injects
  `TOKENS.DomainEventHandlers` (`IDomainEventHandler[]`) and routes events.
- `libs/contracts/src/tokens.ts` — `DomainEventHandlers: Symbol('IDomainEventHandler[]')`.
- `libs/contracts/src/events/domain-event-handler.ts` — `IDomainEventHandler` port.
- `libs/infrastructure/src/outbox/outbox-processor.module.ts` —
  `buildFeatureImports` always adds `AuditModule.register`, `EventsModule.register`,
  `LoggerModule`; used by `forRoot` / `forRootAsync`.
- `apps/api/src/api.module.ts` and Worker composition register `QUEUES.EMAIL`, so
  the welcome-email side effect is a starter example, not generic infra.

## Functional requirements

- **FR-01:** `EventsModule` must accept the list of domain event handlers as
  configuration (e.g. provider tokens/classes supplied via `register` /
  `registerAsync`), instead of hard-coding `UserRegisteredEventHandler`.
- **FR-02:** With no handlers configured, `EventsModule` must provide a valid
  (possibly empty) `TOKENS.DomainEventHandlers` array and a working
  `DomainEventRouter` that routes to zero handlers without error.
- **FR-03:** `UserRegisteredEventHandler` must be registered by the starter's
  composition root as part of the Auth/User example wiring, not by infrastructure
  `EventsModule` defaults.
- **FR-04:** `OutboxProcessorModule` must not force the sample handler into every
  consumer; its `EventsModule` usage must allow zero or caller-supplied handlers.
- **FR-05:** The starter's current runtime behavior (a real `user.registered` event
  still results in a welcome email enqueue) must be preserved end to end via
  composition-root configuration.
- **FR-06:** `TOKENS.DomainEventRouter` / `TOKENS.DomainEventHandlers` contracts and
  `IDomainEventHandler` port remain unchanged.
- **FR-07:** OpenAPI/HTTP contracts unaffected.

## Non-functional requirements

- **NFR-01:** No business logic (welcome email, User specifics) remains in
  infrastructure `events/` defaults after the change.
- **NFR-02:** No circular dependencies introduced between Events, Outbox, Mail/Queue
  modules.
- **NFR-03:** Backward-compatible token symbols and router behavior.

## Public API and interface impact

Module registration API changes (`EventsModule` handler configuration). No
HTTP/SDK/CLI surface change.

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

- The `user.registered` -> welcome-email flow must still work in the starter, driven
  by composition-root-registered handler(s).
- Outbox at-least-once semantics and retry behavior unchanged.
- `QUEUES.EMAIL` registration stays with the entrypoints that enqueue/consume it.

## Security and authorization

- No change. Handlers must not gain broader access than today.

## Entrypoints and deployment impact

| Entrypoint | Impact |
| ---------- | ------ |
| API | Registers the sample `UserRegisteredEventHandler` in its Auth/User composition wiring (it enqueues EMAIL) |
| Worker | If it runs the Outbox processor/handlers, register the same handler set at its composition root |
| Cron | Enqueues outbox processing; handler execution location must remain correct (unchanged from today) |
| `InfrastructureModule` facade (deprecated) | Update to register the sample handler so behavior is retained |

Note: current handler location (which entrypoint actually executes handlers via the
Outbox processor) must be preserved; planning must confirm where
`TOKENS.DomainEventHandlers` is consumed at runtime.

## Observability and operations

- No new metrics; existing outbox/handler logging unchanged.

## Compatibility requirements

- Preserve token symbols and `DomainEventRouter` routing semantics.
- Preserve the observable welcome-email behavior for `user.registered`.
- Handler execution ordering expectations (if any) must not regress.

## Dependencies

- Independent of TASK-007/008 but shares the portability direction.

## Assumptions

- **A-01:** Portability/refactor task, not a backlog defect.
- **A-02:** The welcome-email handler is starter example business, appropriate to
  own at the composition root.
- **A-03:** Parent agent updates `docs/agent-tasks/INDEX.md`.

## Out of scope

- Changing Outbox claim/lock/retry semantics.
- Detaching Audit/Logger from the Outbox processor (Logger portability is TASK-007).
- Introducing an auto-discovery/registry mechanism beyond explicit
  composition-root handler registration (may be an open question).
- Any HTTP/OpenAPI change.

## Acceptance criteria

- **AC-01:** Infrastructure `EventsModule` no longer hard-registers
  `UserRegisteredEventHandler` as a default; handlers are supplied via
  configuration (verified in the diff).
- **AC-02:** A module spec boots `EventsModule` with **no** handlers and resolves a
  `DomainEventRouter` that handles an unknown event without throwing.
- **AC-03:** A module spec boots `EventsModule` with a caller-supplied handler and
  routes a matching event to it.
- **AC-04:** With the starter composition wiring, a `user.registered` event still
  enqueues the welcome email on `QUEUES.EMAIL` (existing handler/outbox specs pass or
  are updated to the new wiring).
- **AC-05:** `OutboxProcessorModule` compiles and runs without forcing the sample
  handler into unrelated consumers.
- **AC-06:** No business logic remains under infrastructure `events/` defaults
  (`user-registered.handler.ts` may move to example/composition wiring or be
  registered from apps).
- **AC-07:** `npm run build`, `npm run lint`, `npm run test:unit`,
  `npm run test:module` succeed.
- **AC-08:** No OpenAPI changes in the diff.

## Verification strategy

- Static: inspect `EventsModule`, `OutboxProcessorModule`, and composition roots for
  removed baked-in handler and correct configurable wiring.
- DI: `npm run test:module` for empty-handler and supplied-handler cases.
- Runtime: trigger registration flow (or drive outbox) and confirm welcome email is
  enqueued in the starter configuration.
- Commands: `npm run build`, `npm run lint`, `npm run test:unit`,
  `npm run test:module`.

## Rollout and rollback

- **Rollout:** Backward-compatible observable behavior; composition roots updated in
  the same task.
- **Rollback:** Revert commit; no data impact.
- **Risk:** Misplacing handler registration could stop welcome emails or run
  handlers in the wrong entrypoint; mitigate with module specs and a runtime check
  plus confirming the runtime consumer of `TOKENS.DomainEventHandlers`.

## Open questions requiring human decision

1. Where should the sample `UserRegisteredEventHandler` live — under an
   `apps/*/composition` example, a dedicated example module, or remain in
   infrastructure but only registered explicitly by apps?
2. Configuration shape for handlers: array of provider classes, provider tokens, or
   a factory returning `IDomainEventHandler[]`?
3. Should `EventsModule` support merging handler sets from multiple imports, or a
   single authoritative handler list per entrypoint?
