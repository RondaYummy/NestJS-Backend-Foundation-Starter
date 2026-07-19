---
task_id: TASK-007
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-007 — Campaigns core public and create flows

## Original request

Перенести ядро кампаній: створення, перегляд, списки, QR, profitable, VIP stub.

## Problem or opportunity

Campaigns — центральний домен OLD; у starter відсутній.

## Goal

Domain/Application/Infra для Campaign (+ linked media), `/v1/campaigns` public/create routes, VIP dashboard as-is.

## Users and actors

- Authenticated campaign owners; public browsers; optional JWT for ranking personalization

## Current system context

- OLD: `v1-campaigns.controller.ts`, `v1-campaigns-vip.controller.ts`, campaigns service, JSONB schedules/rights, S3/QR.
- Starter: no campaigns.

## Functional requirements

- **FR-01:** Campaign aggregate with fields needed for public detail/list/create (status, media, city, rating hooks, soft-delete flag).
- **FR-02:** `POST /v1/campaigns/` creates campaign (+ initial services if OLD does) with transactional integrity (improvement vs OLD).
- **FR-03:** `GET /v1/campaigns/:campaignId`, `GET /v1/campaigns/:id/with-permissions`, paginated list route, QR endpoint, profitable list.
- **FR-04:** `GET /v1/campaigns/vip/dashboard` as-is (including lack of real VIP filter if matrix confirms).
- **FR-05:** Strip `accessRights` from public detail; expose computed `userRights` when authed, per OLD.
- **FR-06:** Persist media/QR via Storage (TASK-006).

## Non-functional requirements

- **NFR-01:** Multi-entity create uses DB transaction.
- **NFR-02:** OpenAPI for all owned routes.

## Public API and interface impact

### HTTP API contract (if applicable)

- Routes in FR-03/FR-04 plus create; auth modes per matrix.
- Response shapes `{ items, total }`, `{ campaigns, city }`, etc. per matrix.
- Errors: proper statuses (D6).

## Data model and migration impact

- `campaigns` (and related) Drizzle tables; JSONB may be retained initially for schedules/rights if needed for parity, with note for later normalization.
- Soft-delete semantics preserved.

## Events, queues and background processing

- Optional `CampaignCreated` outbox event for future notifications.

## Security and authorization

- Create requires JWT user/admin; public reads per matrix.
- Do not leak full accessRights on public GET.

## Entrypoints and deployment impact

- API; Migrations; Storage.

## Observability and operations

- Log create failures after partial upload with cleanup policy documented.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-002, TASK-003, TASK-005 (city refs), TASK-006.
- TASK-004 for owner profile fields as needed.

## Assumptions

- VIP remains a stub if OLD has no filter.
- Initial JSONB retention acceptable for parity.

## Out of scope

- Adm-campaigns privileges/services (TASK-008); workers attach (may overlap—prefer TASK-008 for worker mutate).
- Ranking recompute (TASK-013).

## Acceptance criteria

- **AC-01:** FR-02…FR-05 routes live with OpenAPI.
- **AC-02:** Create is transactional.
- **AC-03:** Public detail omits accessRights; userRights computed when authed.
- **AC-04:** build/lint/tests pass; matrix rows updated.

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

- How much of schedule/accessRights JSONB to normalize in this task vs keep opaque for ETL parity.
