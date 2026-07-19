---
task_id: TASK-020
task_type: infrastructure
status: approved
owner: human-approval-required
---

# TASK-020 — Legacy database ETL into Drizzle schema

## Original request

D3=A: нова схема + одноразове перенесення даних зі старої PostgreSQL.

## Problem or opportunity

Без ETL cutover неможливий; JSONB/array legacy shapes потребують явного mapping.

## Goal

Repeatable ETL tooling (dry-run + apply) from OLD DB into new schema with validation reports; no production run without human approval.

## Users and actors

- Migration operator; human approver for prod

## Current system context

- OLD TypeORM tables; new Drizzle tables from TASK-004…017.
- Starter migrations entrypoint with advisory lock.

## Functional requirements

- **FR-01:** Mapping document table/column/JSONB transformations per entity.
- **FR-02:** ETL script/job readable credentials via env; supports dry-run.
- **FR-03:** Idempotency strategy (truncate staging schema or upsert keys) documented.
- **FR-04:** Validate row counts and critical invariants (unique emails, FK orphans report).
- **FR-05:** Password hashes migrated as-is (bcrypt) so logins work; authVersion initialized safely.
- **FR-06:** Do not migrate plaintext refresh tokens into Redis automatically (users re-login) unless human requests session continuity plan.

## Non-functional requirements

- **NFR-01:** Never point at production without explicit approval (AGENTS.md).
- **NFR-02:** Runnable via migrations app or `scripts/` with clear npm command.

## Public API and interface impact

### HTTP API contract (if applicable)

- None.

## Data model and migration impact

- This task is the data movement; schema must already exist from prior tasks.

## Events, queues and background processing

- Optional one-shot job; not recurring Cron.

## Security and authorization

- Credentials only in env; no dumps committed; sanitize logs.

## Entrypoints and deployment impact

- Migrations/CLI; staging first.

## Observability and operations

- Written ETL report artifact (counts, errors).

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- All domain schema tasks for entities you migrate (004–017 as applicable).
- TASK-002 entity inventory.

## Assumptions

- Users will re-authenticate after cutover unless continuity plan approved.

## Out of scope

- Live dual-write replication.
- Production execution (separate human-approved ops step).

## Acceptance criteria

- **AC-01:** Dry-run on a copy succeeds with report.
- **AC-02:** Apply on staging copy; spot-check login + one campaign + appointment.
- **AC-03:** Mapping doc complete.
- **AC-04:** Tool refuses to run without explicit CONFIRM env for apply.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- Session continuity vs forced re-login.
- Whether to import historical notifications/push subscriptions.
