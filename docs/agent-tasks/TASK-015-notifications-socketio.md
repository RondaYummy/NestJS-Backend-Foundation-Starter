---
task_id: TASK-015
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-015 — In-app notifications and Socket.IO gateway

## Original request

Перенести notifications persistence і Socket.IO gateway з поведінкою як у OLD (D4).

## Problem or opportunity

Realtime notifications — критичний UX; OLD in-memory Map не масштабується.

## Goal

Notification entity + use cases + Socket.IO gateway on API with same events; auth via JWT/cookie; optional Redis adapter follow-up documented.

## Users and actors

- Authenticated socket clients; producers (appointments, admin, schedule)

## Current system context

- OLD: `notifications.gateway.ts`, `notifications.service.ts`, events list in inventory.

## Functional requirements

- **FR-01:** Persist notifications (from/to/campaign/title/message/read/type).
- **FR-02:** Socket events parity: client `notifications`, `new-notifications`, `read`, `read-all`, `remove-notification`, `count-new-notification`; server responses + `new-notification`.
- **FR-03:** Authenticate handshake from token header/cookie compatible with TASK-003.
- **FR-04:** Application port `NotificationRealtimePublisher` so HTTP use cases do not import Socket.IO.
- **FR-05:** Document multi-instance limitation; Redis adapter as follow-up task if needed (not blocking parity on single instance).

## Non-functional requirements

- **NFR-01:** Gateway only in API entrypoint (not Worker/Cron).
- **NFR-02:** Cap remembered connections per user as OLD (5) unless matrix says otherwise.

## Public API and interface impact

### HTTP API contract (if applicable)

- Primarily WS; if any HTTP notification routes exist in OLD, include them per matrix.
- Document WS auth in OpenAPI/description or architecture note linked from matrix.

## Data model and migration impact

- `notifications` table.

## Events, queues and background processing

- Domain/outbox handlers may publish realtime messages from Worker via Redis pub/sub or push-only—choose pattern that preserves “user receives event”; document. Prefer API-local emit for sync path and reliable DB read on reconnect.

## Security and authorization

- Users only access own notifications.
- D6: do not accept anonymous spoofed sender identities.

## Entrypoints and deployment impact

- API (Socket.IO); possibly Redis for future adapter.

## Observability and operations

- Log connect/disconnect with user id; no token logging.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-003; producers TASK-011/014/010 may integrate incrementally.

## Assumptions

- Single API instance sufficient for initial parity (D4).

## Out of scope

- Web Push (TASK-016); Redis adapter implementation unless required now.

## Acceptance criteria

- **AC-01:** Event names and core flows match matrix on single instance.
- **AC-02:** Notifications persist and survive reconnect fetch.
- **AC-03:** No Socket.IO imports in domain/application.
- **AC-04:** build/lint/tests pass.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- Exact Worker→API realtime bridge strategy if notifications are emitted from Worker.
