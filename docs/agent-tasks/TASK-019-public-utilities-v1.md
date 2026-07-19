---
task_id: TASK-019
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-019 — Public utilities status exchange aggregate search

## Original request

Перенести `/v1/status`, PrivatBank exchange, aggregate search, and any remaining misc public routes not owned elsewhere.

## Problem or opportunity

Дрібні але FE-залежні utilities.

## Goal

Parity for status, exchange proxy, aggregate-search; serve-static client only if matrix requires OLD `client/` hosting.

## Users and actors

- Public clients; FE search

## Current system context

- OLD: `v1.controller.ts` status, privatbank-exchange, aggregate-search; ServeStaticModule for `client/`.

## Functional requirements

- **FR-01:** `GET /v1/status` version/status text parity.
- **FR-02:** `GET /v1/privatbank-exchange` with timeout/retry comparable to OLD.
- **FR-03:** `GET /v1/utils/aggregate-search` combining campaigns/services/workers.
- **FR-04:** If FE depends on API-hosted static `client/`, restore ServeStatic or document move to FE hosting (human choice).

## Non-functional requirements

- **NFR-01:** External PrivatBank failures mapped to proper errors (D6), not raw Error 200.
- **NFR-02:** Aggregate search bounded limits.

## Public API and interface impact

### HTTP API contract (if applicable)

- FR-01…FR-03; OpenAPI; response `{ campaigns, services, workers }`.

## Data model and migration impact

- Read models only.

## Events, queues and background processing

- None.

## Security and authorization

- Public; rate limit exchange/search.

## Entrypoints and deployment impact

- API; outbound HTTP to PrivatBank.

## Observability and operations

- Log upstream exchange failures.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-007/009 data for aggregate search.

## Assumptions

- PrivatBank public API remains available.

## Out of scope

- Push subscribe (TASK-016); feedback POST (TASK-017).

## Acceptance criteria

- **AC-01:** Three utility routes match matrix.
- **AC-02:** Upstream failure returns non-200 error envelope.
- **AC-03:** OpenAPI + tests pass.
- **AC-04:** Static hosting decision recorded and implemented if required.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- Host static `client/` on API vs separate FE.
