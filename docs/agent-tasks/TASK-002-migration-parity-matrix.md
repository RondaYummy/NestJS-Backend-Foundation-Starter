---
task_id: TASK-002
task_type: documentation
status: approved
owner: human-approval-required
---

# TASK-002 — Migration parity matrix and contract freeze

## Original request

Оформити всі завдання для переносу OLD_BACKEND у поточний starter; зафіксувати контракт поведінки перед імплементацією.

## Problem or opportunity

Без єдиної parity-matrix команди розходяться щодо того, що саме має працювати як раніше.

## Goal

Створити живий каталог усіх legacy HTTP/WS/cron/push контрактів і мапінг на TASK-003…021, з позначками D6 security overrides.

## Users and actors

- Human approver / tech lead
- Implementers and verifiers of later migration tasks

## Current system context

- Legacy: `OLD_BACKEND/src/v1/*` (~67 routes), Socket.IO notifications, ranking crons, Web Push, Fondy (disabled registration), TypeORM entities.
- Target: starter Auth/Outbox/Mail/Storage/Drizzle; business domains not present.
- Decisions: `docs/agent-tasks/MIGRATION_PROGRAM.md`.

## Functional requirements

- **FR-01:** Document every OLD HTTP route: method, path, auth mode, key request fields, success shape, known error behavior.
- **FR-02:** Document Socket.IO client/server events and auth handshake sources.
- **FR-03:** Document cron jobs, push flows, mail triggers, S3 upload call sites.
- **FR-04:** Map each row to owning TASK-003…021.
- **FR-05:** List D6 intentional breaks (password sanitization, comment author spoofing, Error-as-200 → proper errors) with expected new behavior.
- **FR-06:** Record cookie/header expectations under D2 (JWT + optional cookie transport).

## Non-functional requirements

- **NFR-01:** Matrix lives as markdown under `docs/agent-tasks/` or `docs/migration/`.
- **NFR-02:** No production code changes in this task.

## Public API and interface impact

### HTTP API contract (if applicable)

- Catalog only; this task does not add runtime endpoints.

## Data model and migration impact

- Entity/table inventory and JSONB notes for ETL (feeds TASK-020).

## Events, queues and background processing

- Inventory of side effects that become Outbox/Worker/Cron in later tasks.

## Security and authorization

- Enumerate known defects fixed under D6; do not mark them as required legacy parity.

## Entrypoints and deployment impact

- None (documentation only).

## Observability and operations

- Note OLD admin log-file endpoint and ranking jobs for later ops review.

## Compatibility requirements

- Matrix is the source of truth for “same as OLD” unless a row is marked D6-break.

## Dependencies

- None. Blocks implementation migration tasks.

## Assumptions

- Locked decisions D1–D6 remain stable.

## Out of scope

- Implementation, OpenAPI generation, ETL scripts, frontend changes.

## Acceptance criteria

- **AC-01:** Markdown parity matrix exists and lists all OLD controller routes from inventory.
- **AC-02:** Every route row references a TASK owner ID.
- **AC-03:** D6 break list is explicit for known auth/comment/error issues.
- **AC-04:** `MIGRATION_PROGRAM.md` links to the matrix.
- **AC-05:** INDEX lists TASK-002 as proposed until human approval.

## Verification strategy

- Static cross-check of matrix rows against OLD controllers.
- No runtime commands required beyond doc review.

## Rollout and rollback

- N/A (docs). Update matrix when later tasks discover gaps.

## Open questions requiring human decision

- Confirm cookie names for JWT transport when approving TASK-003.
