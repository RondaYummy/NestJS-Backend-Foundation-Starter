---
task_id: TASK-002
task_type: technical
status: approved
owner: human-approval-required
---

# TASK-002 — Postman collection and agent keep-in-sync workflow

## Original request

Create and keep current a Postman collection for the starter API. When an agent adds or changes an HTTP endpoint, it must also update that collection. Encode this obligation into agent workflow docs/rules (same class of requirement as OpenAPI today).

## Problem or opportunity

The repository has generated OpenAPI (`apps/api/src/openapi/`) and controller surface for Auth, Google Auth, Sessions, and Health, but no checked-in Postman (or equivalent) collection. Integrators and manual testers lack a ready-to-import request set. Agents are required to update OpenAPI on HTTP changes, but nothing requires updating a Postman collection, so collections (if added ad hoc) will drift.

## Goal

1. Ship a canonical Postman Collection v2.1 (JSON) covering current public API routes with usable examples, variables, and auth helpers.
2. Document how to import/use it.
3. Extend agent delivery rules/skills/commands so any task that adds or changes an HTTP endpoint must update the Postman collection in the same change set, with verification expectations.

## Users and actors

- Human integrators importing the collection into Postman/Insomnia-compatible tools.
- Agents defining, planning, implementing, and verifying HTTP endpoint tasks.
- Reviewers checking API contract completeness.

## Current system context

- Controllers (non-exhaustive inventory for the initial collection):
  - `AuthController`: register, login, logout, refresh, me, change-password, forgot-password, reset-password under `/v1/auth`
  - `GoogleAuthController`: `/v1/auth/google`, `/v1/auth/google/callback`
  - `SessionsController`: list/revoke under `/v1/sessions` (session driver)
  - Health: `/health`, `/health/live`, `/health/ready` (no `v1` prefix)
- OpenAPI: `apps/api/src/openapi/create-openapi-document.ts`, drift test `openapi-contract.spec.ts`
- Agent HTTP contract gate today: `.cursor/rules/50-new-task-delivery.mdc`, task definition/planning/implementation/verification skills, and related commands — OpenAPI only; no Postman mention.
- No existing `**/postman*` files on the current branch.
- Global prefix `v1` with health exclusions in `apps/api/src/main.ts`.

## Functional requirements

- **FR-01:** Add a checked-in Postman Collection v2.1 JSON under `docs/postman/` (canonical file, e.g. `docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json` — exact filename may be finalized in planning; one collection file only in that folder aside from env/README).
- **FR-02:** Add a Postman Environment (or collection variables) template under `docs/postman/` for `baseUrl`, and auth-related values (`accessToken`, `refreshToken`, cookie/session placeholders) without real secrets.
- **FR-03:** Initial collection MUST include every current public HTTP route from the API controllers/health surface listed in Current system context, grouped by folder (Auth, Google Auth, Sessions, Health).
- **FR-04:** Each request MUST use collection/environment variables for host and tokens; example bodies MUST match validation DTOs (valid shape, fake data only).
- **FR-05:** Document dual auth drivers briefly in collection description or companion README: JWT Bearer vs session cookie flows for protected routes.
- **FR-06:** Add a short human-facing usage note at `docs/postman/README.md` covering import steps and variable setup.
- **FR-07:** Update agent workflow so HTTP endpoint add/change requires Postman collection update in the same task:
  - `.cursor/rules/50-new-task-delivery.mdc`
  - task-definition / task-planning / task-implementation / task-verification skills (and matching `.cursor/commands/*` if they restate OpenAPI obligations)
  - `docs/agent-tasks/README.md` and/or `AGENTS.md` definition-of-done for new tasks (HTTP bullet)
- **FR-08:** Acceptance language MUST require: new/changed route present in collection; method/path/variables aligned with controller + OpenAPI; no secret values committed.
- **FR-09:** Prefer keeping collection paths aligned with generated OpenAPI; do not invent routes that do not exist.

## Non-functional requirements

- **NFR-01:** Collection JSON MUST be valid Postman Collection v2.1 and pretty-printed for readable diffs.
- **NFR-02:** No real credentials, production URLs, or `.env` secrets in the collection or environment template.
- **NFR-03:** Changes remain documentation/tooling oriented; production runtime behavior unchanged unless explicitly required for docs links.
- **NFR-04:** Avoid mandating Postman CLI in CI unless a lightweight JSON schema/path check is trivial; if automation is added, use existing npm/node patterns.

## Public API and interface impact

### HTTP API contract (if applicable)

- No runtime HTTP API changes.
- Collection is a consumer artifact mirroring OpenAPI/controllers.
- OpenAPI remains the canonical machine contract; Postman is the canonical manual-test artifact.
- Acceptance criterion that verifies Postman coverage: every path+method in the generated OpenAPI (or controller inventory agreed in plan) appears in the collection (scripted check preferred if low-cost; otherwise checklist in verification skill).

## Data model and migration impact

None.

## Events, queues and background processing

None.

## Security and authorization

- Collection may include authenticated requests using `{{accessToken}}` or cookie variables.
- Forbidden: embedding real JWT secrets, Google client secrets, SMTP, or database URLs.

## Entrypoints and deployment impact

- Documentation/tooling only; no deploy entrypoint changes.
- Release archive SHOULD include the Postman folder if it is part of the starter source tree (confirm against `scripts/release` include rules during planning).

## Observability and operations

None required.

## Compatibility requirements

- Additive for humans/agents; no breaking API change.
- Agent rule updates MUST remain compatible with the existing OpenAPI obligations (Postman is additional, not a replacement).

## Dependencies

- Existing OpenAPI document generation (source of truth for path inventory).
- Optional: small node script under `scripts/` to assert OpenAPI paths ⊆ Postman items — only if planning judges it maintainable.

## Assumptions

- Canonical location is `docs/postman/` (human decision, 2026-07-28).
- Postman Collection v2.1 JSON is sufficient; Bruno/Insomnia exports are out of scope unless chosen as an additional format later.
- “When an agent makes a new endpoint” means the full new-task HTTP delivery path (define/plan/implement/verify), not bugfix-only changes unless those bugfixes add/change HTTP endpoints (then the same rule should apply — state this in the rule text).

## Out of scope

- Automating Postman cloud sync / Postman API CI login.
- Full e2e Newman suite as a merge gate (optional follow-up).
- Frontend or non-API entrypoints.
- Fixing auth/session defects (P1-01…P1-04) or Helmet (TASK-001).

## Acceptance criteria

- **AC-01:** Canonical Postman collection file exists and imports cleanly into Postman (structure validated as Collection v2.1).
- **AC-02:** Environment/variable template exists without secrets.
- **AC-03:** All current Auth, Google Auth, Sessions, and Health routes are present with correct methods and paths (including global prefix rules).
- **AC-04:** `docs/postman/README.md` explains import and variables.
- **AC-05:** Agent rules + task skills/commands + DoD docs require Postman updates alongside OpenAPI for HTTP endpoint add/change.
- **AC-06:** Verification skill/checklist includes Postman drift against the changed endpoints.
- **AC-07:** No production code behavior change except docs/rules/scripts explicitly in scope.
- **AC-08:** `npm run lint` still passes if scripts/docs are linted; any new script has a clear npm command or documented invocation.

## Verification strategy

- Inspect collection JSON structure and path coverage vs controllers/OpenAPI.
- Inspect updated `.cursor/rules`, skills, commands, `AGENTS.md` / task README.
- Optionally run a coverage script if added.
- Confirm release archive policy still excludes secrets and includes the collection when intended.

## Rollout and rollback

- Rollout: merge docs + collection; agents follow new rule on next HTTP task.
- Rollback: revert rule text and/or collection file; OpenAPI-only process remains.

## Open questions requiring human decision

1. ~~Canonical path: `postman/` at repo root vs `docs/postman/`?~~ **Decided:** `docs/postman/`.
2. Require an automated OpenAPI↔Postman coverage check in this task, or checklist-only for v1?
3. Should bugfix HTTP endpoint changes be explicitly in scope of the same agent rule (recommended: yes)?
