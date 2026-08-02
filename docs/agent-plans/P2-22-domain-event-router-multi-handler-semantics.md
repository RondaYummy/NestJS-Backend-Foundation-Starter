---
issue_id: P2-22
status: approved
owner: human-approval-required
---

# P2-22 — Document DomainEventRouter multi-handler at-least-once semantics

## Source issue

- Backlog ID: `P2-22`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-22
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Medium — DomainEventRouter all-or-nothing multi-handler without checkpoint)

## Current behavior

Confirmed on current `main` (inspected 2026-08-02):

1. `libs/infrastructure/src/events/domain-event.router.ts` — `DomainEventRouter.route()`:
   - filters registered `IDomainEventHandler` instances with `supports(event.name)`;
   - runs matching handlers **sequentially** (`for … await handler.handle(event)`);
   - any throw aborts the loop; earlier handlers that already completed are **not** rolled back and are **not** checkpointed.
2. `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts` — `publishEvent()` calls `domainEventRouter.route(...)` as a single unit of work. On throw, `markFailed()` sets the outbox row back to `pending` (or `failed` after `maxAttempts`) and a later claim **re-runs the entire route**, including handlers that already succeeded.
3. There is **no** per-handler outbox status, progress cursor, or partial-success marker in schema or processor.
4. Production composition today registers a single handler: `apps/worker/src/worker.module.ts` passes `{ eventHandlers: [UserRegisteredEventHandler] }` into `OutboxProcessorModule`. Multi-handler risk is latent but real for integrators who register ≥2 handlers for the same event name.
5. Docs already state Outbox delivery is **at-least-once** / handlers must be **idempotent** (`README.md` § 5.13 Delivery semantics; `MODULES_OVERVIEW_NON_TECH.md` § Outbox). They do **not** spell out the multi-handler fan-out duplication case (successful handler N re-executes when handler N+1 fails).
6. No false “exactly-once DomainEventRouter” claim was found; gaps are omission of the multi-handler rule and absence of an explicit “no per-handler checkpointing” statement near Domain Events docs.

## Confirmed root cause

Handler fan-out is all-or-nothing at the outbox-row level: success is only recorded after **all** matching handlers complete. Without per-handler progress, a later failure (or crash after partial success) causes at-least-once retry of the whole event, which re-invokes earlier handlers’ side effects. Integrators who register multiple handlers without strong idempotency can observe duplicated side effects — and current docs do not make that hard rule explicit.

## Dependency/runtime flow

```text
Use case (txn)
  -> IOutboxWriter.append(event)   // same PG transaction as business write
       -> outbox_events row (pending)

Cron / Worker
  -> DrizzleOutboxProcessor.processPending()
       -> claimPendingBatch()      // status=processing, lock
       -> publishEventWithTimeout()
            -> DomainEventRouter.route(RoutableDomainEvent)
                 -> filter handlers by supports(name)
                 -> for each matching handler:
                      await handler.handle(event)   // sequential; no checkpoint
                 -> throw on first failure (earlier side effects already done)
       -> success: markProcessed(row)
       -> failure: markFailed(row) -> pending + backoff (or failed)
            -> later claim retries ENTIRE route again
```

## Goal

Document integrator-facing hard rules for DomainEventRouter multi-handler delivery: prefer one handler per event name **or** require every handler to be safe under at-least-once full-event retry; explicitly state that exactly-once and per-handler checkpointing are **not** provided. Do this without changing production runtime code (minimal scope per AC-03).

## Scope

- Update product docs (`README.md` Domain Events / Outbox delivery wording; `MODULES_OVERVIEW_NON_TECH.md` Outbox section) so multi-handler retry duplication and idempotency requirements are explicit.
- Add a short architecture decision record under `docs/architecture/` (recommended; see open questions) capturing the chosen semantics and explicitly rejecting undocumented exactly-once / per-handler progress claims.
- Optionally add a one-line delivery note on the EventsModule row in `docs/infrastructure-modules/EXTRACTION_GUIDE.md` so extractors see the same rule.
- Grep verification that no DomainEventRouter / Outbox docs claim exactly-once or per-handler checkpointing after the change.
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).

## Out of scope

- P2-16 … P2-21, P2-23+, and any other backlog items.
- Any production code change to `DomainEventRouter`, `DrizzleOutboxProcessor`, outbox schema, contracts, DI tokens, or composition roots (AC-03: not required for the minimal fix).
- Designing or implementing per-handler outbox status / checkpointing (explicit optional follow-up only if a human expands scope later).
- Changing shipped handler behavior (`UserRegisteredEventHandler`) or registering additional handlers.
- Rewriting unrelated Outbox wording drift in MODULES (e.g. “event → BullMQ queue” vs router-mediated dispatch) beyond what is needed to state multi-handler semantics clearly.
- HTTP endpoints, OpenAPI, or Postman (`docs/postman/`) — this issue is documentation of existing DomainEventRouter semantics only.

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

| Path | Symbols / responsibility |
| --- | --- |
| `docs/architecture/ADR-002-domain-event-router-multi-handler-semantics.md` | **Recommended.** New ADR (English, same frontmatter style as `ADR-001`): context (sequential fan-out, outbox-row retry), decision (prefer one handler per event **or** idempotent handlers under at-least-once full-event retry; no exactly-once; no per-handler checkpointing in this iteration), consequences, non-goals (per-handler status deferred). |

If humans decline the ADR (open question), create **none** and put the full rule only in README + MODULES.

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `README.md` | § **5.12. Domain Events**: after the two-step Outbox + router model, add an explicit **Delivery / multi-handler** subsection (or bullets) covering: (1) sequential fan-out; (2) failure marks the outbox event failed/retried as a whole; (3) earlier handlers may re-run; (4) hard rule — one handler per event name **or** all handlers idempotent; (5) starter does **not** provide exactly-once or per-handler checkpoints. Cross-link ADR-002 if created. § **5.13** Delivery semantics: one sentence pointing at multi-handler duplication (not only crash-after-route). Keep existing at-least-once wording; do not introduce exactly-once claims. |
| `MODULES_OVERVIEW_NON_TECH.md` | § **21. Outbox Module**: after the existing at-least-once / idempotent handlers paragraph (~L360), add plain-language note that if several handlers listen to the same event, a later failure can cause earlier handlers to run again on retry — prefer one handler or make each idempotent. |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md` | Optional one-line under **EventsModule** table (e.g. **Semantics** / **Do not**): multi-handler = at-least-once full-event retry; no per-handler progress. |
| `docs/agent-plans/INDEX.md` | Add row for `P2-22` → this plan while `proposed`. |

## Files to delete

- None.

## Contract and DI changes

- **None.** `IDomainEventRouter`, `IDomainEventHandler`, `TOKENS.DomainEventRouter` / `TOKENS.DomainEventHandlers`, `EventsModule.register`, `OutboxProcessorModule`, and Worker composition remain unchanged.
- Public **documentation** contract only: integrators must treat multi-handler registration as at-least-once with possible duplicate earlier side effects.

## Implementation steps

1. Confirm still no per-handler progress in `domain-event.router.ts` / outbox schema (sanity before editing docs).
2. **Write ADR-002** (unless humans opt out): decision = document-only hard rule; explicitly list non-goals (per-handler outbox status).
3. **Update `README.md` § 5.12** with multi-handler semantics and hard integrator rule; add a short cross-reference from § 5.13 Delivery semantics.
4. **Update `MODULES_OVERVIEW_NON_TECH.md`** Outbox section with the same rule in non-technical language.
5. **Optionally** add EXTRACTION_GUIDE EventsModule one-liner.
6. **Grep** docs for `exactly-once` / DomainEventRouter claims; remove or reword any false claim if found (none expected today for the router itself; preserve correct “not exactly-once” Outbox wording).
7. Do **not** edit production TypeScript, backlog issue status, or mark P2-22 resolved.
8. Do **not** change plan frontmatter `status` away from `proposed` / human `approved`.

## Migration and rollout concerns

- Documentation-only: no DB migration, env change, or deploy ordering.
- Existing single-handler Worker composition remains correct; no behavior change for current demo.
- Integrators who already registered multiple non-idempotent handlers for one event name may discover they were always at risk — docs make that visible; runtime unchanged.

## Targeted verification

| Check | Purpose |
| --- | --- |
| Read `README.md` § 5.12 (+ § 5.13 cross-ref) | AC-01: multi-handler retry duplication + idempotency / one-handler rule present. |
| Read `MODULES_OVERVIEW_NON_TECH.md` Outbox | Same rule in non-tech language. |
| Read ADR-002 (if created) | Decision + explicit non-claims (no exactly-once, no per-handler checkpoint). |
| `rg -i "exactly-once\|DomainEventRouter\|per-handler\|checkpoint" README.md MODULES_OVERVIEW_NON_TECH.md docs/architecture/` | AC-02: no false exactly-once / checkpoint claims for DomainEventRouter; at-least-once / “not exactly-once” preserved. |
| Confirm no `libs/` / `apps/` diff | AC-03: production code untouched for minimal scope. |

No build/test suite is required for a docs-only change; optional `npm run lint` is unnecessary if no TS/ESLint targets change.

## Full verification

| Check | Purpose |
| --- | --- |
| `git diff --stat` / `git status` | Only intended doc/ADR/index paths changed; no production code. |
| Spot-check Worker still documents / registers single `UserRegisteredEventHandler` | Demo remains the one-handler reference pattern. |

Do not require `npm run build`, `test:unit`, `test:module`, `test:int`, or Postman coverage for this issue.

## Acceptance criteria

- **AC-01:** Docs explicitly describe multi-handler retry duplication risk and required idempotency (or one-handler-per-event preference). Met by README § 5.12 (+ MODULES; ADR if approved).
- **AC-02:** No false exactly-once (or per-handler checkpointing) claims remain for DomainEventRouter. Met by explicit “not provided” wording + grep clean of contradictory claims.
- **AC-03:** Code change not required for the minimal doc/ADR fix unless a human expands scope. Met by zero production file edits under this plan.
- No HTTP/OpenAPI/Postman work invented for this issue.

## Risks

- Docs-only fix leaves latent multi-handler runtime risk for integrators who ignore the rule — acceptable under backlog severity Medium / AC-03; mitigate with clear hard-rule language and ADR.
- Over-editing MODULES Outbox section could mix in unrelated drift fixes and expand review surface — keep the multi-handler paragraph tightly scoped.
- Duplicate messaging across README / MODULES / ADR can drift later — keep ADR as canonical decision; README/MODULES summarize and link.

## Rollback strategy

- Revert the documentation/ADR commits (or delete ADR-002 and restore prior README/MODULES paragraphs). No data or runtime rollback needed.

## Open questions requiring human decision

1. **Include ADR-002?** Recommended yes (`docs/architecture/ADR-002-domain-event-router-multi-handler-semantics.md`, English, `status: accepted` after human approve of the *plan* then implementer writes ADR as part of the fix). Alternative: README + MODULES only (still satisfies AC-01/AC-02 if wording is complete).
2. **EXTRACTION_GUIDE one-liner?** Optional; default **yes** for extractors, skip if humans want fewer touch points.
3. **Expand to per-handler outbox status?** Default **no** (out of scope). Say yes only if this plan is deliberately widened into a code+schema change (would require a revised plan).
