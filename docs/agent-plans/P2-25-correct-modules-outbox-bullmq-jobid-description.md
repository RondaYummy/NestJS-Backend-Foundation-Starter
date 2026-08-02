---
issue_id: P2-25
status: approved
owner: human-approval-required
---

# P2-25 — Correct MODULES outbox BullMQ `jobId` description

## Source issue

- Backlog ID: `P2-25`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-25
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Medium — MODULES outbox BullMQ `jobId` from outbox event id)

## Current behavior

Confirmed on current `main` (inspected 2026-08-02):

1. `MODULES_OVERVIEW_NON_TECH.md` § **21. Outbox Module** (~L340–L358) states:
   - “Кожна подія додається у відповідну BullMQ queue”;
   - “BullMQ job використовує стабільний jobId, побудований на основі outbox event id”;
   - follow-on caveats about Redis retention / `removeOnComplete` and the need for separate idempotency for critical side effects.
2. Actual cron enqueue — `apps/cron/src/schedules/outbox.schedule.ts` (`OutboxSchedule.tick`):
   - under distributed lock `cron:outbox`, calls `IQueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', {}, { jobId: 'outbox-process-pending', removeOnComplete: true, removeOnFail: true })`;
   - **one fixed** BullMQ `jobId`, not derived from any outbox row id;
   - covered by `apps/cron/src/schedules/outbox.schedule.spec.ts` (expects `jobId: 'outbox-process-pending'`).
3. Actual worker processing — `apps/worker/src/processors/create-outbox-processor.ts` consumes `QUEUES.OUTBOX` and delegates to `IOutboxProcessor.processPending()` (`DrizzleOutboxProcessor`):
   - `claimPendingBatch()` → `publishEvent()` → `DomainEventRouter.route(...)` (no per-event outbox-queue job creation).
4. Per-event BullMQ `jobId` appears **downstream** in handlers, e.g. `libs/infrastructure/src/events/examples/user-registered.handler.ts` (`UserRegisteredEventHandler.handle`) enqueues `QUEUES.EMAIL` with `jobId: \`welcome-email:${event.id}\`` (and `idempotencyKey: \`user-registered:${event.id}:welcome\``).
5. `README.md` § **5.13. Outbox Module** does **not** duplicate the false “outbox queue jobId = outbox event id” claim. It describes Cron enqueue of a processing job and Worker claim/route semantics, plus at-least-once / idempotency. No README `jobId`-from-event-id wording was found via repo-wide markdown grep.

## Confirmed root cause

Non-technical Outbox docs describe a **per-event outbox-queue dedupe** model (stable BullMQ `jobId` built from outbox event id) that the implemented pipeline does not use. The real model is two-stage: Cron enqueues a **singleton** outbox-processing job (`outbox-process-pending`) → Worker claims a DB batch and routes handlers → handlers may enqueue **downstream** jobs with per-event `jobId` / idempotency keys.

## Dependency/runtime flow

```text
Cron (OutboxSchedule.tick)
  -> DistributedLock.runWithLock('cron:outbox', ...)
       -> QueueGateway.add(QUEUES.OUTBOX, 'process-pending-outbox-events', {},
            { jobId: 'outbox-process-pending', removeOnComplete, removeOnFail })

Worker (OutboxProcessorHost @Processor(QUEUES.OUTBOX))
  -> IOutboxProcessor.processPending()
       -> claimPendingBatch()          // PG FOR UPDATE SKIP LOCKED
       -> publishEvent() / DomainEventRouter.route(event)
            -> IDomainEventHandler.handle(event)
                 -> e.g. QueueGateway.add(QUEUES.EMAIL, ..., { jobId: `welcome-email:${event.id}` })
       -> markProcessed / markFailed
```

## Goal

Align `MODULES_OVERVIEW_NON_TECH.md` Outbox wording with the real two-stage jobId model so integrators are not told that the outbox queue uses a per-event `jobId`. Keep production code unchanged (issue explicitly prefers docs-only unless a human chooses to implement per-event outbox jobIds).

## Scope

- Rewrite the misleading Outbox flow / `jobId` paragraphs in `MODULES_OVERVIEW_NON_TECH.md` § 21 to describe:
  1. Cron → fixed BullMQ jobId `outbox-process-pending` on `QUEUES.OUTBOX`;
  2. Worker → DB claim/batch → `DomainEventRouter` / handlers;
  3. Downstream handler enqueue may use per-event `jobId` / idempotency (example: welcome email).
- Preserve accurate caveats: BullMQ `jobId` dedupe is limited by Redis retention / `removeOnComplete`; Outbox remains at-least-once; critical side effects still need separate idempotency.
- Grep product docs for any remaining claim that **outbox queue** `jobId` equals / is built from outbox event id; remove or reword if found (expected: MODULES only today).
- Spot-check `README.md` for the duplicated false claim; update **only if** such a claim exists (current branch: none found).
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).

## Out of scope

- P2-16 … P2-24, P2-26+, and any other backlog items (including P2-22 DomainEventRouter multi-handler semantics).
- Any production code change to `OutboxSchedule`, `DrizzleOutboxProcessor`, queue gateway, handlers, contracts, DI, or composition roots.
- Implementing per-event outbox-queue `jobId`s (explicitly rejected by the backlog issue unless a human revises scope).
- Broad rewrite of `README.md` § 5.13 historical flow bullets (“Подія публікується в BullMQ queue”) beyond removing a duplicated false jobId claim if one appears.
- Changing Cron `removeOnComplete` / `removeOnFail` policy or fixed jobId constant.
- HTTP endpoints, OpenAPI, or Postman (`docs/postman/`).

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None (documentation correction only).

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `MODULES_OVERVIEW_NON_TECH.md` | § **21. Outbox Module**: replace the “each event → BullMQ queue” + “stable jobId from outbox event id” narrative (~L340–L358) with the two-stage flow (fixed cron jobId → DB claim/batch → handler enqueue with optional per-event jobId/idempotency). Keep at-least-once / idempotency guidance. Language may stay Ukrainian to match the file. |
| `README.md` | **Conditional only:** if a false “outbox queue jobId = outbox event id” claim is found at implement time, reword to match code. Current inspection found **no** such claim — do not invent unrelated README edits. |
| `docs/agent-plans/INDEX.md` | Add row for `P2-25` → this plan while `proposed`. |

## Files to delete

- None.

## Contract and DI changes

- **None.** `IQueueGateway`, `QUEUES.OUTBOX`, `OutboxSchedule`, `OutboxProcessorModule`, `DomainEventRouter`, and handler registrations remain unchanged.
- Public **documentation** contract only: integrators must understand that outbox-queue dedupe is a singleton processing job, not per outbox-row BullMQ jobIds.

## Implementation steps

1. Re-read `OutboxSchedule.tick` and `UserRegisteredEventHandler.handle` to confirm fixed vs per-event jobIds still match this plan.
2. Edit `MODULES_OVERVIEW_NON_TECH.md` § 21:
   - Adjust the ordered flow bullets so Cron enqueue of one processing job and Worker DB claim/route are explicit (not “each outbox event becomes an outbox-queue job”).
   - Replace the false “jobId from outbox event id” paragraph with: fixed `jobId: 'outbox-process-pending'` (dedupes concurrent cron ticks while the job still exists in Redis); per-event ids belong to downstream jobs/handlers.
   - Keep / lightly adapt the `removeOnComplete` and separate-idempotency caveats so they apply correctly to whichever stage uses stable jobIds (cron singleton and/or downstream handler jobs).
3. Grep markdown for `jobId` / “outbox event id” / “стабільний jobId” claims; ensure AC-02 is satisfied.
4. Do **not** touch `libs/` or `apps/` TypeScript.
5. Do **not** edit backlog issue status or mark P2-25 resolved.
6. Do **not** change plan frontmatter `status` away from `proposed` / human `approved`.

## Migration and rollout concerns

- Documentation-only: no DB migration, env change, or deploy ordering.
- Runtime behavior unchanged; no compatibility break for existing deployments.
- Readers who relied on the incorrect per-event outbox-queue dedupe story may need to rely on DB claim locking + handler idempotency (already required elsewhere).

## Targeted verification

| Check | Purpose |
| --- | --- |
| Read `MODULES_OVERVIEW_NON_TECH.md` § 21 | AC-01: docs match `OutboxSchedule` / processor / handler jobId behavior (two-stage flow). |
| `rg -n "jobId|outbox event id|стабільний jobId|outbox-process-pending|welcome-email" MODULES_OVERVIEW_NON_TECH.md README.md` | AC-02: no remaining claim that outbox-queue jobId equals outbox event id; fixed cron jobId and/or downstream per-event example present where appropriate. |
| Diff check vs `apps/cron/src/schedules/outbox.schedule.ts` and `user-registered.handler.ts` | Narrative matches symbols (`outbox-process-pending`, `welcome-email:${event.id}`). |
| Confirm no `libs/` / `apps/` diff | Docs-only scope honored. |

No build/test suite is required for a docs-only change; do not require `npm run build` / `lint` / Jest for acceptance.

## Full verification

| Check | Purpose |
| --- | --- |
| `git diff --stat` / `git status` | Only intended doc/index paths changed; no production code. |
| Optional re-read README § 5.13 | Still no false jobId-from-event-id claim; no accidental contradictory edit. |

Do not require `npm run test:unit`, `test:module`, `test:int`, bootstrap, or Postman coverage for this issue.

## Acceptance criteria

- **AC-01:** Docs match `OutboxSchedule` / processor behavior (fixed outbox-queue jobId → DB claim/batch → handler-side per-event jobId where applicable). Met by updated MODULES § 21.
- **AC-02:** No remaining claim that outbox queue `jobId` equals / is built from outbox event id unless code is deliberately changed to do so (out of scope). Met by MODULES rewrite + grep clean of that claim across product docs touched by this plan.
- No HTTP/OpenAPI/Postman work for this issue.
- No production runtime code changes under the default (docs-only) scope.

## Risks

- Over-editing MODULES could collide with P2-22’s planned multi-handler paragraph in the same section — keep this fix limited to jobId / two-stage enqueue narrative; do not absorb P2-22 wording.
- Mentioning concrete constants (`outbox-process-pending`, `welcome-email:…`) may drift if code renames them later — acceptable for a starter kit; prefer naming the stages clearly and citing the constant once.
- Leaving README § 5.13 “publishes to BullMQ” historical wording may still confuse some readers — accepted as out of scope unless humans expand this plan.

## Rollback strategy

- Revert the documentation commit(s) that change MODULES (and README if touched). No data or runtime rollback needed.

## Open questions requiring human decision

1. **Also lightly align README § 5.13 flow bullet “Подія публікується в BullMQ queue”?** Default **no** (not a duplicated jobId claim; avoids scope creep). Say **yes** only if humans want the technical README flow to explicitly name the fixed cron jobId in the same change set.
2. **Implement per-event outbox-queue jobIds in code instead of (or in addition to) docs?** Default **no** per backlog “Required change”. Say **yes** only with a revised plan (would be a code+DI+test change, not docs-only).
