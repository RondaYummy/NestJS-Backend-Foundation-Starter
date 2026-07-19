---
task_id: TASK-005
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-005 — Cities domain search and seed

## Original request

Перенести міста/пошук міст і bootstrap dataset з OLD.

## Problem or opportunity

Campaigns/users залежать від cities; OLD сіє `cities.json` на bootstrap — у starter це неприйнятно.

## Goal

Cities schema, search endpoints, one-shot/seed job via Migrations (or explicit CLI), not API bootstrap.

## Users and actors

- Public API clients; migration operator

## Current system context

- OLD: `City` entity, `GET /v1/city`, `GET /v1/user-city`, `cities.json` import when empty outside development.
- Starter: no cities.

## Functional requirements

- **FR-01:** Drizzle `cities` table with uniqueness compatible with OLD.
- **FR-02:** `GET /v1/city/:limit?searchValue=` and `GET /v1/user-city?searchValue=` parity.
- **FR-03:** Seed from `OLD_BACKEND` cities dataset via migrations app or documented npm script (not API onModuleInit).
- **FR-04:** Idempotent seed (safe to re-run).

## Non-functional requirements

- **NFR-01:** Seed must not run implicitly on every API start.
- **NFR-02:** Search performance acceptable for autocomplete (index on name as needed).

## Public API and interface impact

### HTTP API contract (if applicable)

- FR-02 public routes; OpenAPI + drift.

## Data model and migration impact

- New `cities` table + seed data path for TASK-020 (may load from JSON rather than OLD DB).

## Events, queues and background processing

- None required.

## Security and authorization

- Public read endpoints; no PII.

## Entrypoints and deployment impact

- API (read); Migrations/seed job.

## Observability and operations

- Log seed counts.

## Compatibility requirements

- Preserve OLD path prefixes under `/v1` for endpoints owned by this task (D1).
- Response bodies for successful legacy routes must match the parity matrix from TASK-002 unless D6 explicitly changes them.
- Auth uses starter JWT; cookie transport per TASK-003 when applicable (D2).

## Dependencies

- TASK-002.

## Assumptions

- `regions.json` has no runtime consumer (confirm in matrix); seed cities only unless matrix finds otherwise.

## Out of scope

- Admin CRUD for cities if not present in OLD.

## Acceptance criteria

- **AC-01:** Endpoints match matrix.
- **AC-02:** Seed job populates empty DB idempotently.
- **AC-03:** API start does not import cities as side effect.
- **AC-04:** build/lint/tests pass.

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

- None.
