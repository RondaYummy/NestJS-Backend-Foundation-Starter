---
task_id: TASK-004
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-004 — Extended user profile and /v1/users parity

## Original request

Перенести профіль користувача, settings, password restore та related `/v1/users` / `/v1/profile` з OLD.

## Problem or opportunity

Starter User має лише email/password/roles/authVersion; OLD users значно ширші.

## Goal

Розширити User domain/schema і забезпечити parity endpoints профілю, оновлень, restore-password, settings, city.

## Users and actors

- Authenticated users; optional-auth callers for restore/change-city as in OLD

## Current system context

- OLD: `v1-users.controller.ts`, `user.service.ts`, restore-password entity, S3 photo update.
- Starter: minimal users table + GetCurrentUser.

## Functional requirements

- **FR-01:** Extend domain/DB user fields needed by OLD profile (phone, names, city ref, status, settings JSON, favorites, push ids, ranking fields as required by later tasks).
- **FR-02:** `GET /v1/profile` returns sanitized current user (no password).
- **FR-03:** `GET /v1/users/` search with pagination semantics from matrix.
- **FR-04:** `POST /v1/users/update-user`, `change-email`, `set-password`, `change-city`, `PATCH /v1/users/settings`.
- **FR-05:** Restore password: `restore-password`, `check`, `setup` with mail via Outbox → Worker (templates may land here or with shared mail task).
- **FR-06:** Duplicate email/phone rejected as in OLD.

## Non-functional requirements

- **NFR-01:** Photo upload uses Storage port (TASK-006 may land first or in parallel with stub).
- **NFR-02:** All mutations transactional where multi-step.

## Public API and interface impact

### HTTP API contract (if applicable)

- Paths: FR-02…FR-05 under `/v1/profile` and `/v1/users`.
- Auth modes per matrix (JWT required vs optional).
- OpenAPI + drift for each route; D6: never expose password hashes.

## Data model and migration impact

- Drizzle migration altering `users`; `restore_passwords` (or equivalent) table.
- ETL mapping defined for TASK-020.

## Events, queues and background processing

- Password-reset email via Outbox/Worker.
- Domain events optional (`UserProfileUpdated`, etc.) if needed by notifications later.

## Security and authorization

- Change-email/set-password require re-auth checks as OLD.
- Restore tokens hashed at rest; single-use/expiry policy documented from OLD or improved under D6 if OLD was weak (document choice).

## Entrypoints and deployment impact

- API; Worker for mail; Migrations for schema.

## Observability and operations

- Audit sensitive profile changes when audit port is available.

## Compatibility requirements

- Preserve OLD path prefixes under `/v1` for endpoints owned by this task (D1).
- Response bodies for successful legacy routes must match the parity matrix from TASK-002 unless D6 explicitly changes them.
- Auth uses starter JWT; cookie transport per TASK-003 when applicable (D2).

## Dependencies

- TASK-002; TASK-003 (auth) strongly recommended first.
- TASK-006 for real photo uploads (may accept temporary skip with AC note).

## Assumptions

- Phone uniqueness rules match OLD.
- Mail driver configured in non-null envs for restore flow verification.

## Out of scope

- Admin user update (TASK-014); push subscribe endpoints (TASK-016).

## Acceptance criteria

- **AC-01:** Schema + domain support FR-01 fields used by these endpoints.
- **AC-02:** All FR-02…FR-05 routes match matrix (except D6 sanitization).
- **AC-03:** Restore flow sends email in worker path when SMTP enabled.
- **AC-04:** OpenAPI drift + build/lint/tests pass.

## Verification strategy

- Unit tests for use cases and pure domain rules.
- Module/OpenAPI drift tests for every HTTP route owned by this task.
- `npm run build:api` (and `build:worker` / `build:cron` / `build:migrations` when those entrypoints change).
- `npm run lint` and relevant `npm run test:unit` / `test:module`.
- Smoke against parity-matrix rows for this task.

## Rollout and rollback

- Prefer completing the slice before exposing `/v1` routes in production.
- Rollback: revert deploy; no TypeORM hybrid.
- Schema changes: forward-only Drizzle migrations; ETL is TASK-020.

## Open questions requiring human decision

- Whether to strengthen restore-token TTL/hash policy beyond OLD (allowed under D6 if documented in matrix).
