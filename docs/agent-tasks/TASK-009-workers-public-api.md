---
task_id: TASK-009
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-009 — Workers public profile API

## Original request

Перенести публічні worker endpoints.

## Problem or opportunity

FE показує профілі майстрів і їхні сервіси окремо від campaign admin.

## Goal

`GET /v1/workers/:id` and `GET /v1/workers/:id/services` parity.

## Users and actors

- Public clients

## Current system context

- OLD: `v1-workers.controller.ts`.

## Functional requirements

- **FR-01:** Public worker profile by id.
- **FR-02:** Worker services list with campaignId/skip/limit filters as OLD.

## Non-functional requirements

- **NFR-01:** OpenAPI documented; no auth required if matrix says public.

## Public API and interface impact

### HTTP API contract (if applicable)

- FR-01/FR-02 paths, query params, response shapes per matrix.

## Data model and migration impact

- Uses users + services + campaign membership from prior tasks.

## Events, queues and background processing

- None.

## Security and authorization

- Public reads; do not leak private settings/password.

## Entrypoints and deployment impact

- API.

## Observability and operations

- None special.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-007/TASK-008 (services & membership).

## Assumptions

- Worker is a user role/flag as in OLD.

## Out of scope

- Admin worker management beyond public GETs.

## Acceptance criteria

- **AC-01:** Both routes match matrix.
- **AC-02:** OpenAPI drift + tests pass.

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
