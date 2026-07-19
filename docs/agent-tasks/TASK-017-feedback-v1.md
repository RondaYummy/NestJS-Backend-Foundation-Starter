---
task_id: TASK-017
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-017 — Feedback public and admin persistence

## Original request

Перенести feedback as-is (D5), включаючи те, що public save було закоментоване в OLD — зафіксувати в matrix і відтворити або свідомо увімкнути під D6.

## Problem or opportunity

D5 says migrate everything; public feedback persistence is currently disabled in OLD code.

## Goal

Feedback entity + admin list/status + public POST behavior explicitly matching human choice recorded in matrix (reproduce disabled OR enable save).

## Users and actors

- Public submitters; admins

## Current system context

- OLD: `POST /v1/feedback` with persistence commented; admin feedback endpoints active.

## Functional requirements

- **FR-01:** Feedback schema fields from OLD entity.
- **FR-02:** Admin list/filter/status update parity (TASK-014 may own admin HTTP—this task owns domain/persistence and public POST).
- **FR-03:** Public POST: default **enable persistence** under D6/D5 clarification unless matrix marks “preserve disabled” — must be explicit in Open questions resolution before implement.
- **FR-04:** Validation/consent fields as OLD DTO.

## Non-functional requirements

- **NFR-01:** Rate limit public feedback POST.

## Public API and interface impact

### HTTP API contract (if applicable)

- `POST /v1/feedback`; admin routes if not already in TASK-014 (avoid duplication—single owner).

## Data model and migration impact

- `feedbacks` table.

## Events, queues and background processing

- None required.

## Security and authorization

- Public POST; admin mutations admin-only.
- D6: basic abuse controls.

## Entrypoints and deployment impact

- API; Migrations.

## Observability and operations

- Counters include feedbacks (TASK-014).

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-002 matrix decision on disabled save; TASK-014 for admin UI routes coordination.

## Assumptions

- Human will resolve disabled-vs-enable before implementation approval.

## Out of scope

- Payments.

## Acceptance criteria

- **AC-01:** Persistence layer + chosen public POST behavior implemented.
- **AC-02:** Admin can list/update statuses.
- **AC-03:** OpenAPI + tests pass.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- **Must decide:** keep public feedback non-persistent like OLD code, or enable save (recommended).
