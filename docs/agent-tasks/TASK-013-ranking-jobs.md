---
task_id: TASK-013
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-013 — Ranking recalculation Cron and Worker

## Original request

Перенести ranking crons (campaigns/workers/services) і log cleanup admin cron у модель Cron→queue→Worker з locks.

## Problem or opportunity

OLD runs `@Cron` inside API without distributed locks — unsafe multi-instance.

## Goal

Reimplement ranking formulas and schedules using Cron entrypoint + BullMQ + Worker; distributed locks; optional log cleanup job for admin logs feature.

## Users and actors

- System scheduler; indirectly end users seeing profitable lists

## Current system context

- OLD: `ranking-system.service.ts` every 12h/weekly; admin log cleanup weekly.

## Functional requirements

- **FR-01:** Ranking score formula parity: appointments×3 + positive ratings×5 over 90 days (confirm in matrix).
- **FR-02:** Campaign/worker/service ranking jobs on equivalent cadences.
- **FR-03:** Cron only enqueues under Redis lock; Worker performs computation.
- **FR-04:** Log cleanup job if TASK-014 keeps backend-logs file feature; otherwise document skip.

## Non-functional requirements

- **NFR-01:** Avoid N+1 where practical without changing scores.
- **NFR-02:** Jobs idempotent enough for retries.

## Public API and interface impact

### HTTP API contract (if applicable)

- No new HTTP required; profitable endpoints consume updated fields.

## Data model and migration impact

- Ranking columns on campaigns/users/services.

## Events, queues and background processing

- New BullMQ job types + Cron schedules.

## Security and authorization

- Jobs are internal; no public trigger without auth (if admin trigger exists in OLD, document).

## Entrypoints and deployment impact

- Cron; Worker; queue registry.

## Observability and operations

- Job success/failure logs; duration metrics.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-007, TASK-011, TASK-012 data available.
- TASK-014 if log cleanup tied to admin logs.

## Assumptions

- Cadences match OLD unless ops asks otherwise.

## Out of scope

- HTTP profitable endpoint implementation (already in TASK-007) except score refresh.

## Acceptance criteria

- **AC-01:** Jobs registered and runnable in worker.
- **AC-02:** Cron uses distributed lock.
- **AC-03:** Score formula unit-tested.
- **AC-04:** build worker/cron + tests pass.

## Verification strategy

- Unit tests for domain/use cases; OpenAPI drift for HTTP routes.
- `npm run build:api` (+ worker/cron/migrations as touched).
- `npm run lint`; `test:unit` / `test:module` as relevant.
- Smoke parity-matrix rows.

## Rollout and rollback

- Expose `/v1` routes when slice is complete.
- Forward-only Drizzle migrations; ETL in TASK-020.
- Rollback via deploy revert.

## Open questions requiring human decision

- Whether to keep file-based backend logs at all (see TASK-014).
