---
task_id: TASK-018
task_type: feature
status: approved
owner: human-approval-required
---

# TASK-018 — Fondy payments as-is

## Original request

Перенести payments (Fondy/CloudIPSP) as-is (D5), навіть якщо в OLD вимкнено реєстрацію модуля.

## Problem or opportunity

Code exists but is dangerous (hard-coded test checkout on bootstrap). Must migrate carefully.

## Goal

Port Fondy integration behind explicit config flag defaulting OFF; no checkout on process bootstrap; expose same API surface OLD intended once identified in matrix.

## Users and actors

- Paying users; ops enabling payments

## Current system context

- OLD: `payments.service.ts` commented out of AppModule; SDK dependency present.

## Functional requirements

- **FR-01:** Inventory actual public payment endpoints/methods from OLD (may be none registered)—document in matrix.
- **FR-02:** Implement application/infrastructure adapter for Fondy without running payments on module init.
- **FR-03:** Feature flag `PAYMENTS_ENABLED` default false.
- **FR-04:** If no HTTP surface existed, provide internal port + minimal admin/test route only if matrix requires; otherwise library+adapter only with docs.

## Non-functional requirements

- **NFR-01:** No secrets in code; env-based merchant credentials.
- **NFR-02:** D6: remove hard-coded checkout invocation.

## Public API and interface impact

### HTTP API contract (if applicable)

- Only routes that existed or were clearly intended; OpenAPI if any HTTP.

## Data model and migration impact

- Payment/transaction tables only if OLD had them (confirm—may be none).

## Events, queues and background processing

- Prefer Worker for capture/webhook handling if webhooks exist.

## Security and authorization

- Validate Fondy callbacks/signatures; do not trust client amounts unchecked.

## Entrypoints and deployment impact

- API and/or Worker; env credentials.

## Observability and operations

- Explicit ops runbook: how to enable payments safely.

## Compatibility requirements

- Preserve OLD `/v1` paths for this task (D1).
- Match TASK-002 matrix unless D6 break.
- Auth via TASK-003 JWT (+ cookies).

## Dependencies

- TASK-002 inventory of payment surface.

## Assumptions

- D5 includes unfinished payments; production enable is ops decision.

## Out of scope

- Full billing/subscriptions product redesign.

## Acceptance criteria

- **AC-01:** No payment execution on bootstrap.
- **AC-02:** Flag default off.
- **AC-03:** Documented adapter + any matrix routes.
- **AC-04:** build/lint pass.

## Verification strategy

- Unit/module tests; OpenAPI drift for HTTP routes.
- Build affected entrypoints; lint; smoke matrix rows.

## Rollout and rollback

- Complete slice before production expose.
- Forward-only migrations; ETL TASK-020.

## Open questions requiring human decision

- Confirm whether any HTTP payment routes must exist for FE today.
