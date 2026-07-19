---
task_id: TASK-011
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-011 — Appointments booking and slot calculation

## Original request

Перенести створення appointment і розрахунок слотів (`exclusions`), плюс calendar records data for admin.

## Problem or opportunity

Складна scheduling логіка в монолітному service; side effects mail/push/notification синхронні.

## Goal

Domain/application for booking + slot calculation; HTTP parity; side effects via Outbox/Worker.

## Users and actors

- Clients booking; masters; campaign admins viewing records

## Current system context

- OLD: `appointments.service.ts`, `POST /v1/appointments/`, `POST /v1/appointments/exclusions`, admin records DTO with bgcolor/title/etc.

## Functional requirements

- **FR-01:** Create appointment with validations (worker in campaign, services provided, slot free) matching OLD rules.
- **FR-02:** Slot calculation endpoint public as OLD.
- **FR-03:** 15-minute grid, breaks, exclusions, durations honored.
- **FR-04:** On create, enqueue notification/mail/push per worker/user settings (Worker handlers may be completed in TASK-015/016/mail).
- **FR-05:** Supply read model for admin calendar records shape.

## Non-functional requirements

- **NFR-01:** Slot engine unit-tested extensively.
- **NFR-02:** Booking uses transaction + conflict detection.

## Public API and interface impact

### HTTP API contract (if applicable)

- Appointment POST routes; records response fields per matrix; OpenAPI.

## Data model and migration impact

- `appointments` table; FKs where feasible.

## Events, queues and background processing

- `AppointmentBooked` outbox → email/push/notification processors.

## Security and authorization

- Create: JWT user/admin; exclusions: public; records: campaign appointment read permission.

## Entrypoints and deployment impact

- API; Worker; Migrations.

## Observability and operations

- Metrics/log booking conflicts.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-007…010.
- Soft deps TASK-015/016 for delivery channels.

## Assumptions

- Mail templates for appointments ported or minimal placeholder until templates copied.

## Out of scope

- Ranking recompute (TASK-013).

## Acceptance criteria

- **AC-01:** Create + exclusions match matrix for happy path and major conflict cases.
- **AC-02:** Side effects go through async pipeline (not best-effort only in HTTP thread).
- **AC-03:** Records DTO fields available to admin route.
- **AC-04:** Tests + OpenAPI drift pass.

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

- Exact mail template port timing vs placeholder.
