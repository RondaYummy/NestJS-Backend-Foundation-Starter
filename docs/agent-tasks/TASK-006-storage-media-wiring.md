---
task_id: TASK-006
task_type: infrastructure
status: approved
owner: human-approval-required
---

# TASK-006 — Storage composition for media uploads

## Original request

Підключити Storage адаптер starter до API composition для фото профілю/кампаній/сервісів і QR, як S3 у OLD.

## Problem or opportunity

`StorageModule` існує, але не підключений до entrypoints; OLD викликає AWS S3 напряму з сервісів/контролерів.

## Goal

Wire storage into API (and Worker if needed), define upload use helpers/ports usage, env for S3/local, without embedding SDK in domain.

## Users and actors

- API upload flows; operators configuring S3

## Current system context

- Starter: local + S3-compatible storage adapters.
- OLD: `aws-s3.service.ts` used by users/campaigns.

## Functional requirements

- **FR-01:** Register Storage in API composition root against contracts tokens.
- **FR-02:** Provide application-facing upload/delete helpers usable by profile/campaign/service tasks.
- **FR-03:** Support `STORAGE_DRIVER=local|s3` via existing config.
- **FR-04:** Document key/prefix conventions for user/campaign/service/QR objects.

## Non-functional requirements

- **NFR-01:** No AWS SDK imports outside infrastructure.
- **NFR-02:** Failures map to typed application/HTTP errors.

## Public API and interface impact

### HTTP API contract (if applicable)

- No standalone public routes required; enables multipart/base64 flows in dependent tasks.
- If a dedicated upload endpoint is introduced, document OpenAPI fully; prefer parity with OLD (uploads embedded in existing POSTs).

## Data model and migration impact

- Store object keys/URLs on entities in later tasks; no mandatory new table here.

## Events, queues and background processing

- Optional async image processing later; not required for parity.

## Security and authorization

- Uploads only from authenticated flows that OLD required; validate content-type/size policy (document defaults; improve under D6 if OLD had none).

## Entrypoints and deployment impact

- API composition; env S3_*; local path volume in docker.

## Observability and operations

- Log storage failures with object key, not secrets.

## Compatibility requirements

- Preserve OLD path prefixes under `/v1` for endpoints owned by this task (D1).
- Response bodies for successful legacy routes must match the parity matrix from TASK-002 unless D6 explicitly changes them.
- Auth uses starter JWT; cookie transport per TASK-003 when applicable (D2).

## Dependencies

- TASK-002.

## Assumptions

- S3-compatible endpoint works for production like OLD AWS S3.

## Out of scope

- Full campaign create flow (TASK-007); CDN invalidation.

## Acceptance criteria

- **AC-01:** Storage resolvable from API composition.
- **AC-02:** Integration smoke: put/get/delete against local driver in tests or scripted check.
- **AC-03:** build/lint pass; no domain layer storage imports.

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

- Max upload size and allowed MIME types if not defined in OLD.
