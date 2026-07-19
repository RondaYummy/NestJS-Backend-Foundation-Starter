---
task_id: TASK-012
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-012 — Comments and reviews

## Original request

Перенести comments/reviews API з D6 fix author spoofing.

## Problem or opportunity

OLD дозволяє `from` у body; D6 вимагає виправлення.

## Goal

Comments create/list/can-do/admin-hide with rating stats; author from auth principal when present.

## Users and actors

- Users, public readers, admins

## Current system context

- OLD: `v1-comments.controller.ts`, 30-day can-do rule, soft-hide.

## Functional requirements

- **FR-01:** `POST /v1/comments/` — author identity from JWT when required; ignore/forbid spoofed `from` (D6); document optional anonymous behavior from matrix.
- **FR-02:** `GET /v1/comments/:itemId` with stats/pagination/rating filters.
- **FR-03:** `GET /v1/comments/can-do/:itemId`.
- **FR-04:** `DELETE /v1/comments/:commentId` admin soft-hide.

## Non-functional requirements

- **NFR-01:** OpenAPI documents auth rules clearly.

## Public API and interface impact

### HTTP API contract (if applicable)

- FR-01…FR-04; D6 break called out in matrix for `from` field.

## Data model and migration impact

- `comments` table.

## Events, queues and background processing

- Optional rating aggregation hooks toward TASK-013.

## Security and authorization

- D6: no author spoofing; admin-only hide.

## Entrypoints and deployment impact

- API; Migrations.

## Observability and operations

- None special.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-007; TASK-011 for can-do appointment history.

## Assumptions

- 30-day window preserved.

## Out of scope

- Ranking job internals (TASK-013).

## Acceptance criteria

- **AC-01:** List/create/can-do/delete match matrix except D6 author rule.
- **AC-02:** Spoofed `from` cannot attribute comment to another user.
- **AC-03:** OpenAPI + tests pass.

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

- Whether anonymous comments remain allowed exactly as OLD.
