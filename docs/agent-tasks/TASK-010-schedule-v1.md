---
task_id: TASK-010
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-010 — Worker schedule and day exclusions

## Original request

Перенести `/v1/schedule` створення day-off/vacation і оновлення тижневого графіка.

## Problem or opportunity

Schedule JSONB і permissioned mutations критичні для appointment slots.

## Goal

Application use cases for schedule update/create exclusions with campaign permission checks and worker notifications hooks.

## Users and actors

- Campaign privileged users; notified workers

## Current system context

- OLD: `v1-schedule.controller.ts`, schedule overlap rules, notifications.

## Functional requirements

- **FR-01:** `POST /v1/schedule/:campaignId` for day-off/vacation/hospital/maternity/shortened/extended.
- **FR-02:** `PUT /v1/schedule/` for main/break weekly schedule.
- **FR-03:** Enforce `CAMPAIGN_WORKERS_WORK_SCHEDULE_*` permissions.
- **FR-04:** Overlap prevention rules from OLD.
- **FR-05:** Emit notification side effect via port/Outbox (integrate with TASK-015 when available).

## Non-functional requirements

- **NFR-01:** Pure scheduling rules testable without Nest.

## Public API and interface impact

### HTTP API contract (if applicable)

- FR-01/FR-02; OpenAPI; errors for overlap/forbidden.

## Data model and migration impact

- Persist schedule/exclusions on campaign/worker model (JSONB or tables) consistently with TASK-007.

## Events, queues and background processing

- Notification outbox events preferred.

## Security and authorization

- JWT + campaign schedule permissions.

## Entrypoints and deployment impact

- API; Worker if notifications async.

## Observability and operations

- Log rejected overlaps.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-008 permissions model.
- TASK-015 for full notification delivery (hook can be no-op port initially if sequenced earlier—document).

## Assumptions

- Slot calculation consumes this data in TASK-011.

## Out of scope

- Appointment booking (TASK-011).

## Acceptance criteria

- **AC-01:** Both schedule routes work with permission checks.
- **AC-02:** Overlap rules unit-tested.
- **AC-03:** OpenAPI drift green.

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

- None.
