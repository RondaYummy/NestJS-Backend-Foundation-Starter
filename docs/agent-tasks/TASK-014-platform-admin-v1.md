---
task_id: TASK-014
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-014 — Platform admin panel API

## Original request

Перенести `/v1/admin/*` (counters, lists, user update, notifications send, feedbacks admin, backend-logs) as-is (D5).

## Problem or opportunity

Окремий admin surface від campaign admin.

## Goal

Full platform admin HTTP parity under JWT admin role.

## Users and actors

- Platform admins

## Current system context

- OLD: `v1-admin.controller.ts`, `admins.service.ts`, file log reading.

## Functional requirements

- **FR-01:** `GET /v1/admin/`, counters, feedbacks list/status update, admins-list, users-list, campaigns-list.
- **FR-02:** `PUT /v1/admin/update-user/:userId` role/status/contact.
- **FR-03:** `POST /v1/admin/send-notification/:userId`.
- **FR-04:** `GET /v1/admin/backend-logs` as-is (D5), with production risk documented; prefer read-only scoped access and path traversal protection (D6 hardening without removing feature).

## Non-functional requirements

- **NFR-01:** Admin-only guard on all routes.
- **NFR-02:** OpenAPI complete.

## Public API and interface impact

### HTTP API contract (if applicable)

- All FR routes; response shapes `maxPages` etc. per matrix.

## Data model and migration impact

- Uses users/campaigns/feedbacks/notifications tables from other tasks.

## Events, queues and background processing

- send-notification should write notification + realtime/push hooks (TASK-015/016).

## Security and authorization

- Role admin required.
- D6: harden log endpoint (no path escape); never expose secrets in log API responses beyond what OLD showed—still dangerous, document ops warning.

## Entrypoints and deployment impact

- API; file volume for logs if applicable; prefer structured logger sinks over files long-term (out of scope to replace entirely).

## Observability and operations

- Warn in README/ops notes about backend-logs in production.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-003/004; TASK-007; TASK-017 for feedback entities; TASK-015 for notification send.

## Assumptions

- D5 requires keeping backend-logs despite risk; D6 adds hardening.

## Out of scope

- Campaign-level adm-campaigns (TASK-008).

## Acceptance criteria

- **AC-01:** All admin routes implemented with admin guard.
- **AC-02:** Log endpoint rejects path traversal.
- **AC-03:** OpenAPI + tests pass; ops warning documented.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- Whether to disable backend-logs outside production via env (allowed if default matches OLD availability).
