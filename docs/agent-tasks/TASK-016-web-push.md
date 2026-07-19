---
task_id: TASK-016
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-016 — Web Push subscriptions and delivery

## Original request

Перенести Web Push subscribe/unsubscribe і VAPID sends.

## Problem or opportunity

OLD stores push subscriptions and sends from request path; should use Worker for sends.

## Goal

Push subscription persistence + `/v1/push-subscribe` / unsubscribe parity + Worker sender using web-push/VAPID.

## Users and actors

- Authenticated users; Worker

## Current system context

- OLD: push module, `push-subscribes` entity, test message on subscribe.

## Functional requirements

- **FR-01:** Store subscription endpoint/keys/user.
- **FR-02:** `POST /v1/push-subscribe`, `DELETE /v1/push-unsubscribe` parity (including test push if matrix requires).
- **FR-03:** Delivery port used by appointment/admin flows; actual HTTP to push service in Worker.
- **FR-04:** Honor user settings that disable push when present.

## Non-functional requirements

- **NFR-01:** VAPID keys via env; never commit secrets.
- **NFR-02:** Failed endpoints cleaned or marked per OLD behavior / improved under D6 with docs.

## Public API and interface impact

### HTTP API contract (if applicable)

- Subscribe/unsubscribe routes; JWT auth; OpenAPI.

## Data model and migration impact

- `push_subscriptions` table.

## Events, queues and background processing

- `PushNotification` jobs on BullMQ.

## Security and authorization

- Users manage only own subscriptions.

## Entrypoints and deployment impact

- API; Worker; env VAPID_*.

## Observability and operations

- Log push failures without dumping subscription keys.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-003/004 settings; TASK-011/015 producers.

## Assumptions

- Browser Web Push only (no FCM native unless OLD had it—matrix).

## Out of scope

- Mobile native push providers.

## Acceptance criteria

- **AC-01:** Subscribe/unsubscribe work.
- **AC-02:** Worker can send a notification to a stored subscription in non-prod with VAPID configured.
- **AC-03:** OpenAPI + tests pass.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- None.
