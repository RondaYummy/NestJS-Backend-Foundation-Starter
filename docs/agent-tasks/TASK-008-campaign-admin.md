---
task_id: TASK-008
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-008 — Campaign admin privileges services and workers mutate

## Original request

Перенести `/v1/adm-campaigns/*` і мутації workers на кампанії.

## Problem or opportunity

Права доступу, сервіси майстрів і admin UX — окремий великий шматок поверх core campaigns.

## Goal

Parity for privileges, my campaigns, service CRUD/assign, worker add/remove, soft-delete, calendar records endpoint shell if tied here.

## Users and actors

- Campaign owners and delegated workers with permission flags

## Current system context

- OLD: `v1-campaigns-admin.controller.ts`, worker add/remove on `v1-campaigns`, permission enums, 24h privilege update cooldown.

## Functional requirements

- **FR-01:** Permission model compatible with OLD accessRights / userRights checks.
- **FR-02:** Privileges read/update routes; enforce 24h cooldown and non-owner cannot grant PRIVILEGES_UPDATE.
- **FR-03:** `GET /v1/adm-campaigns/my`; campaign update; soft-delete owner-only.
- **FR-04:** Services create/update/delete/assign/unassign under adm-campaigns.
- **FR-05:** `POST/DELETE /v1/campaigns/:id/worker/:workerId` with default schedule side effects as OLD.
- **FR-06:** `GET /v1/adm-campaigns/:campaignId/records` returns calendar DTO shape (may call appointment read model from TASK-011; if TASK-011 not ready, define port and stub only if human allows—prefer implementing after or with TASK-011).

## Non-functional requirements

- **NFR-01:** Permission checks in application layer, not only controllers.
- **NFR-02:** OpenAPI includes permission error responses.

## Public API and interface impact

### HTTP API contract (if applicable)

- All `/v1/adm-campaigns/*` and worker mutate routes from matrix; OpenAPI + drift.

## Data model and migration impact

- Service entity table; worker membership representation (prefer relational over string arrays where possible without breaking ETL—document mapping).

## Events, queues and background processing

- Worker add/remove may notify via Outbox (TASK-015).

## Security and authorization

- Enforce campaign permission codes exactly as matrix/OLD.
- D6: consistent 403/401 instead of soft Error returns.

## Entrypoints and deployment impact

- API; Migrations.

## Observability and operations

- Audit privilege changes.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-007 required.
- TASK-011 for full records data (coordinate sequencing).

## Assumptions

- 24h privilege cooldown preserved.

## Out of scope

- Schedule day-off APIs (TASK-010); ranking (TASK-013).

## Acceptance criteria

- **AC-01:** FR-01…FR-05 implemented with tests for permission matrix.
- **AC-02:** Soft-delete owner-only.
- **AC-03:** OpenAPI drift green; matrix updated.
- **AC-04:** Records endpoint either fully wired or explicitly deferred with human-approved note in matrix.

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

- Sequencing of records endpoint vs TASK-011.
