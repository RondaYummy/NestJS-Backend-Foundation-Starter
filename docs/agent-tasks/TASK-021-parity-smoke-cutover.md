---
task_id: TASK-021
task_type: infrastructure
status: approved
owner: human-approval-required
---

# TASK-021 — Staging parity smoke and cutover

## Original request

Фіналізувати перенос: прогін parity на staging і план cutover з OLD на новий стек.

## Problem or opportunity

Імплементація по зрізах не гарантує end-to-end готовність.

## Goal

Automated/scripted smoke against TASK-002 matrix on staging; cutover checklist; decommission plan for OLD_BACKEND deploy.

## Users and actors

- QA/tech lead; ops

## Current system context

- All feature tasks proposed; after implementation, staging runs new API/Worker/Cron/Migrations.

## Functional requirements

- **FR-01:** Smoke suite covering critical matrix rows (auth, campaign create/read, schedule, appointment slots/book, comments, admin lists, ws notification connect, push subscribe if keys present).
- **FR-02:** Cutover checklist: migrate schema, ETL, enable env flags, switch traffic, monitor, rollback path.
- **FR-03:** Explicit D6 deviations list attached to release notes.
- **FR-04:** Plan to remove or archive `OLD_BACKEND/` from deploy (repo copy may remain for reference).

## Non-functional requirements

- **NFR-01:** Smoke runnable in CI against staging or documented manual procedure.
- **NFR-02:** No production cutover without human approval gate.

## Public API and interface impact

### HTTP API contract (if applicable)

- Validates existing contracts; does not add features.

## Data model and migration impact

- Uses TASK-020 outputs.

## Events, queues and background processing

- Verify Cron ranking enqueue and Worker consumers healthy post-cutover.

## Security and authorization

- Confirm password hashes not leaking; cookies secure in prod; payments flag off unless intended.

## Entrypoints and deployment impact

- All four entrypoints; docker/compose/prod docs updates as needed (docs only if required for cutover).

## Observability and operations

- Health endpoints; error budget watch first 48h.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-003…020 implemented & verified individually.

## Assumptions

- Staging mirrors prod integrations sufficiently (S3/SMTP/VAPID optional skips noted).

## Out of scope

- New product features beyond OLD.

## Acceptance criteria

- **AC-01:** Smoke suite exists and passes on staging for mandatory rows.
- **AC-02:** Cutover checklist merged in docs.
- **AC-03:** Rollback drill documented.
- **AC-04:** Human sign-off section included (unchecked).

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- Traffic switch mechanism (DNS, reverse proxy, k8s service).
