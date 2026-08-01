---
task_id: TASK-002
specification: docs/agent-tasks/TASK-002-postman-collection-and-agent-sync.md
status: approved
owner: human-approval-required
---

# TASK-002 — Implementation plan

## Approved specification

- Task index: `docs/agent-tasks/INDEX.md` — **TASK-002** (technical / **approved**)
- Specification: `docs/agent-tasks/TASK-002-postman-collection-and-agent-sync.md`
- Canonical Postman location (human-decided): `docs/postman/`

**Re-validation (this planning pass):**

- No `**/postman*` files exist on the branch (confirmed via workspace search).
- Controllers + health still match the OpenAPI drift inventory in `apps/api/src/openapi/openapi-contract.spec.ts`.
- Agent HTTP gate today mentions OpenAPI only (rule `50-new-task-delivery.mdc`, task skills/commands, `AGENTS.md`, `docs/agent-tasks/README.md`); no Postman obligation.
- Release archive uses `git archive` (`scripts/release/build-archive.ts`); `docs/` is not forbidden by `release-policy.ts`, so tracked `docs/postman/**` is included once committed.
- Branch `main` is up to date with `origin/main`. Unrelated staged file: `docs/agent-reports/TASK-001-verification.md` (out of scope for this plan).

## Current implementation

### HTTP surface (source of truth for initial collection)

Global prefix `v1` with health exclusions in `apps/api/src/main.ts`:

```ts
application.setGlobalPrefix('v1', {
  exclude: ['health', 'health/live', 'health/ready'],
});
```

| Folder | Method | Path | Controller / notes |
| --- | --- | --- | --- |
| Auth | POST | `/v1/auth/register` | `AuthController.register` — body `RegisterDto` |
| Auth | POST | `/v1/auth/login` | `AuthController.login` — body `LoginDto`; JWT tokens or session cookie |
| Auth | POST | `/v1/auth/logout` | `AuthController.logout` — optional `LogoutDto.refreshToken`; dual-driver |
| Auth | POST | `/v1/auth/refresh` | `AuthController.refresh` — body `RefreshTokenDto` (JWT) |
| Auth | GET | `/v1/auth/me` | `AuthController.me` — Bearer **or** session cookie |
| Auth | POST | `/v1/auth/change-password` | `AuthController.changePassword` — body `ChangePasswordDto`; auth required |
| Auth | POST | `/v1/auth/forgot-password` | `AuthController.forgotPassword` — body `ForgotPasswordDto`; public |
| Auth | POST | `/v1/auth/reset-password` | `AuthController.resetPassword` — body `ResetPasswordDto`; public |
| Google Auth | GET | `/v1/auth/google` | `GoogleAuthController` — optional query `returnUrl` |
| Google Auth | GET | `/v1/auth/google/callback` | Query `code` / `state` / optional Google echoes; browser redirect flow |
| Sessions | GET | `/v1/sessions` | Session driver + cookie only |
| Sessions | DELETE | `/v1/sessions/others` | Session driver + cookie only |
| Sessions | DELETE | `/v1/sessions` | Revoke all / current; clears cookie |
| Sessions | DELETE | `/v1/sessions/:id` | Path param UUID; `SessionIdParamDto` |
| Health | GET | `/health` | `HealthController.check` — **no** `v1` prefix |
| Health | GET | `/health/live` | Liveness |
| Health | GET | `/health/ready` | Readiness |

Exact path+method list mirrors `expectedRoutes` in `openapi-contract.spec.ts` (OpenAPI uses `{id}` style; Postman raw URL should use `{{sessionId}}`).

### Validation DTO example shapes (fake data only)

| DTO | Example body / params |
| --- | --- |
| `RegisterDto` / `LoginDto` | `{ "email": "user@example.com", "password": "StrongPassword123!" }` |
| `LogoutDto` | `{ "refreshToken": "{{refreshToken}}" }` (omit body keys for session-mode requests if documenting both) |
| `RefreshTokenDto` | `{ "refreshToken": "{{refreshToken}}" }` |
| `ChangePasswordDto` | `{ "currentPassword": "OldPassword123!", "newPassword": "NewStrongPassword123!" }` |
| `ForgotPasswordDto` | `{ "email": "user@example.com" }` |
| `ResetPasswordDto` | `{ "token": "{{resetToken}}", "newPassword": "NewStrongPassword123!" }` |
| Google start | `?returnUrl={{returnUrl}}` |
| Google callback | `?code={{googleAuthCode}}&state={{googleAuthState}}` (placeholders; not a secret store) |
| Sessions `:id` | `/v1/sessions/{{sessionId}}` with fake UUID e.g. `550e8400-e29b-41d4-a716-446655440000` |

### OpenAPI / drift pattern to mirror

- Factory: `apps/api/src/openapi/create-openapi-document.ts`
- Drift test: `apps/api/src/openapi/openapi-contract.spec.ts` — Nest testing module with Auth / Google / Sessions / Health controllers, `v1` prefix + health excludes, asserts every path+method exists.
- Dual auth schemes in OpenAPI: `bearerAuth` + `sessionCookie` (cookie name default `sid`).

### Dual-driver auth (documentation only)

- **JWT (`AUTH_DRIVER=jwt`):** protected routes use `Authorization: Bearer {{accessToken}}`; refresh/logout use `{{refreshToken}}` in JSON body.
- **Session (`AUTH_DRIVER=session`):** protected routes and all `/v1/sessions/*` use Cookie `{{sessionCookieName}}={{sessionCookieValue}}` (default name `sid`). Sessions routes return `400 SESSION_DRIVER_REQUIRED` under JWT.
- Collection must document both; requests should be runnable after the human pastes tokens/cookie values into variables — no committed secrets.

### Agent workflow touchpoints (OpenAPI-only today)

| Path | Current HTTP obligation |
| --- | --- |
| `.cursor/rules/50-new-task-delivery.mdc` | OpenAPI define/plan/implement/verify |
| `.cursor/skills/task-definition/SKILL.md` | OpenAPI requirements + ACs |
| `.cursor/skills/task-planning/SKILL.md` | OpenAPI files + drift-test |
| `.cursor/skills/task-implementation/SKILL.md` | Update OpenAPI in same task + drift check |
| `.cursor/skills/task-verification/SKILL.md` | Compare OpenAPI vs runtime + drift test |
| `.cursor/commands/define-task.md` | Restates OpenAPI ACs |
| `.cursor/commands/plan-task.md` | Restates OpenAPI planning |
| `.cursor/commands/implement-task.md` | Restates OpenAPI implement |
| `.cursor/commands/verify-task.md` | Restates OpenAPI verify |
| `AGENTS.md` | Task definition/planning/implementation/verification + DoD bullet 7 (OpenAPI) |
| `docs/agent-tasks/README.md` | OpenAPI canonical contract paragraph |
| Bugfix skills / `plan-fix` / `implement-fix` / `verify-fix` | **No** OpenAPI or Postman HTTP wording today |

### Release / tooling

- `git archive` includes all tracked paths except those never committed; no special exclude for `docs/`.
- Secret scan (`shouldScanEntryForSecrets`) will scan Postman JSON if included; placeholders must avoid real key patterns.
- Unit Jest (`jest.unit.config.ts`) matches `**/*.spec.ts` excluding `*.module.spec.ts` and `scripts/release/` — a coverage spec under `apps/api/src/openapi/` runs in `npm run test:unit`.

## Architecture decision

1. **Canonical collection filename (recommended):**  
   `docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json`  
   Matches the specification example and package display name. One collection JSON only in that folder aside from environment + README.

2. **Variables: collection defaults + separate environment file (recommended):**  
   - Collection `variable[]` holds empty/safe defaults so import-alone works.  
   - Companion `docs/postman/local.postman_environment.json` for local override of the same keys.  
   Shared variable names: `baseUrl`, `accessToken`, `refreshToken`, `sessionCookieName`, `sessionCookieValue`, `resetToken`, `sessionId`, `returnUrl`, `googleAuthCode`, `googleAuthState`.  
   Defaults: `baseUrl=http://localhost:3000`, `sessionCookieName=sid`, all token/cookie/code values empty strings or clearly fake placeholders (no real JWTs).

3. **Lightweight OpenAPI↔Postman coverage check (recommended: yes for v1):**  
   Add `apps/api/src/openapi/postman-coverage.spec.ts` that:
   - Reuses the same Nest test-app bootstrap pattern as `openapi-contract.spec.ts` (or shares a tiny local helper in that folder if duplication is painful — prefer minimal shared helper only if needed).
   - Builds OpenAPI via `createOpenApiDocument`.
   - Loads the checked-in collection JSON from `docs/postman/…postman_collection.json`.
   - Recursively walks Postman `item` trees; for each request extracts HTTP method + path (strip `{{baseUrl}}`, ignore query string for matching).
   - Asserts every OpenAPI `paths[path][method]` appears in the collection (OpenAPI `{id}` ↔ Postman `{{sessionId}}` normalized to the same template form, e.g. both compared as `/v1/sessions/{id}`).
   - Asserts `info.schema` is `https://schema.getpostman.com/json/collection/v2.1.0/collection.json` (or equivalent v2.1 marker).
   - Does **not** require Postman CLI / Newman / new npm dependencies.
   - Wire optional convenience script in `package.json`: `"test:postman-coverage": "node node_modules/jest/bin/jest.js --config jest.unit.config.ts --testPathPatterns=postman-coverage"` (AC-08). Still covered by `npm run test:unit` / `test:all`.

4. **Bugfix HTTP endpoint changes in the same obligation (recommended: yes):**  
   Extend task delivery rule wording and also bugfix planning / implementation / verification skills so any **bugfix that adds or changes an HTTP endpoint** updates OpenAPI **and** the Postman collection in the same change set. Bugfix slash-commands currently do not restate OpenAPI; add a single HTTP-contract sentence to `plan-fix.md` / `implement-fix.md` / `verify-fix.md` only if those files gain explicit HTTP wording — otherwise skill text is sufficient and commands stay thin pointers to skills.

5. **No production runtime behavior change.** Controllers, `main.ts`, auth drivers, and OpenAPI generation logic stay untouched except the new **test** file under `apps/api/src/openapi/` (test-only; not runtime).

6. **Pretty-printed Collection v2.1 JSON** with 2-space indent for readable diffs (NFR-01).

7. **Do not invent routes.** Initial inventory is exactly the OpenAPI `expectedRoutes` table above; no admin, worker, or docs UI routes.

## Scope

- Create `docs/postman/` collection + environment + README.
- Add OpenAPI⊆Postman coverage unit spec (+ optional npm script alias).
- Update agent rules, task skills, matching task commands, `AGENTS.md`, and `docs/agent-tasks/README.md` so Postman is mandatory alongside OpenAPI for HTTP add/change.
- Update bugfix skills (and optionally thin fix-command wording) so HTTP-changing bugfixes also update Postman.
- Brief pointer in human docs if README already points at OpenAPI (optional one-liner under API docs section) — only if needed for discoverability; not a substitute for `docs/postman/README.md`.

## Out of scope

- Postman cloud sync, Newman e2e merge gate, Bruno/Insomnia alternate exports.
- Changing runtime HTTP behavior, auth drivers, Helmet (TASK-001), or P1 auth defects.
- Inventing routes not present in controllers/OpenAPI.
- Making Postman the machine-canonical contract (OpenAPI remains canonical).
- Requiring `REQUIRED_ARCHIVE_ENTRIES` for the collection (inclusion via normal `git archive` is enough).
- Fixing unrelated INDEX gaps (e.g. missing TASK-001 plan row) beyond adding TASK-002.

## Files to create

| Path | Responsibility |
| --- | --- |
| `docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json` | Collection v2.1: folders Auth, Google Auth, Sessions, Health; all routes above; collection description covering dual auth; variables; Bearer auth helper where useful; fake example bodies. |
| `docs/postman/local.postman_environment.json` | Environment template mirroring collection variable keys; empty secrets; `baseUrl` local default. |
| `docs/postman/README.md` | Import steps (collection + env), variable setup, JWT vs session cookie usage, note that OpenAPI is canonical and collection must stay in sync. |
| `apps/api/src/openapi/postman-coverage.spec.ts` | Unit test: OpenAPI path+method ⊆ Postman items; schema v2.1; no secrets heuristic optional (empty token vars). |

## Files to modify

| Path | Change |
| --- | --- |
| `package.json` | Add `test:postman-coverage` script alias (Jest pattern); no new dependencies. |
| `.cursor/rules/50-new-task-delivery.mdc` | Extend HTTP bullet: Postman collection under `docs/postman/` updated with OpenAPI; verification includes coverage check / checklist; state that bugfixes adding/changing HTTP endpoints share the same Postman (+ OpenAPI) obligation. |
| `.cursor/skills/task-definition/SKILL.md` | Require Postman update requirements/ACs for HTTP endpoint add/change (alongside OpenAPI). |
| `.cursor/skills/task-planning/SKILL.md` | Plan exact Postman collection/item updates + coverage verification with OpenAPI. |
| `.cursor/skills/task-implementation/SKILL.md` | Same-task Postman update; do not complete HTTP phase without collection alignment; run/postman-coverage when applicable. |
| `.cursor/skills/task-verification/SKILL.md` | Verify changed routes in collection vs controller/OpenAPI; run `postman-coverage` / unit gate; reject secrets in collection/env. |
| `.cursor/commands/define-task.md` | Restate Postman alongside OpenAPI. |
| `.cursor/commands/plan-task.md` | Restate Postman planning alongside OpenAPI. |
| `.cursor/commands/implement-task.md` | Restate Postman update alongside OpenAPI. |
| `.cursor/commands/verify-task.md` | Restate Postman drift/coverage alongside OpenAPI drift. |
| `.cursor/skills/bugfix-planning/SKILL.md` | When the fix adds/changes HTTP endpoints: plan OpenAPI + Postman updates. |
| `.cursor/skills/bugfix-implementation/SKILL.md` | When HTTP endpoints change: update OpenAPI + Postman in the same change set. |
| `.cursor/skills/change-verification/SKILL.md` | When HTTP endpoints changed: verify OpenAPI + Postman coverage / no secrets. |
| `AGENTS.md` | Task workflow bullets + DoD item 7: Postman collection kept aligned with OpenAPI for HTTP add/change. |
| `docs/agent-tasks/README.md` | Extend HTTP paragraph: OpenAPI canonical machine contract; Postman canonical manual-test artifact under `docs/postman/`. |
| `docs/agent-plans/INDEX.md` | Add TASK-002 proposed row (this plan). |
| `README.md` (optional, minimal) | One discoverability link to `docs/postman/README.md` near §3.1.1 OpenAPI if a docs index exists — only if implementer finds a natural single-line slot; not required for AC-04. |

## Files to delete

None.

## Domain changes

None.

## Application changes

None.

## Contract and DI changes

None.

## Infrastructure changes

None (health controller already exists; collection only documents it).

## Interface and entrypoint changes

- **No** `apps/api/src/main.ts`, controller, or DTO production edits.
- **Test-only** addition under `apps/api/src/openapi/postman-coverage.spec.ts`.
- Worker / Cron / Migrations: untouched.

## Database and migration changes

None.

## Security and authorization changes

- Documentation/tooling only: collection may reference `{{accessToken}}` / cookie variables.
- Forbidden: real JWTs, Google client secrets, DB URLs, SMTP passwords, production hosts.
- Coverage/verification must reject non-placeholder secret-looking values if an assert is cheap; otherwise README + verification skill checklist.

## Observability changes

None.

## Implementation phases

### Phase 1 — Postman collection + environment + README

- **Paths:**  
  `docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json`  
  `docs/postman/local.postman_environment.json`  
  `docs/postman/README.md`
- **Responsibilities:** Collection v2.1 with folders Auth / Google Auth / Sessions / Health; every route in the inventory; variables; dual-auth description; fake DTO-shaped bodies; env template; human import docs.
- **ACs:** AC-01, AC-02, AC-03, AC-04, AC-07 (docs only), NFR-01, NFR-02, FR-01…FR-06, FR-09
- **Verify:** Inspect JSON schema URL / structure; greppable method+path coverage vs `openapi-contract.spec.ts` `expectedRoutes`; confirm no real secrets; optional manual Postman import by human (agent validates structure).

### Phase 2 — OpenAPI↔Postman coverage unit test + npm alias

- **Paths:** `apps/api/src/openapi/postman-coverage.spec.ts`, `package.json`
- **Symbols:** `describe('Postman coverage')` (or equivalent); path normalization helper local to the spec; load collection via `path.join` from repo root / `__dirname`.
- **ACs:** AC-03 (automated), AC-06 (feeds verification), AC-08, NFR-04
- **Verify:**  
  `npm run test:unit -- --testPathPatterns=postman-coverage`  
  and/or `npm run test:postman-coverage`

### Phase 3 — Agent workflow (tasks + DoD)

- **Paths:**  
  `.cursor/rules/50-new-task-delivery.mdc`  
  `.cursor/skills/task-definition/SKILL.md`  
  `.cursor/skills/task-planning/SKILL.md`  
  `.cursor/skills/task-implementation/SKILL.md`  
  `.cursor/skills/task-verification/SKILL.md`  
  `.cursor/commands/define-task.md`  
  `.cursor/commands/plan-task.md`  
  `.cursor/commands/implement-task.md`  
  `.cursor/commands/verify-task.md`  
  `AGENTS.md`  
  `docs/agent-tasks/README.md`
- **Responsibilities:** Postman obligation parallel to OpenAPI for HTTP add/change; AC language: route present, method/path/variables aligned, no secrets; verification skill runs coverage test.
- **ACs:** AC-05, AC-06, FR-07, FR-08
- **Verify:** Static inspection that each file mentions Postman alongside OpenAPI for HTTP changes.

### Phase 4 — Bugfix HTTP parity

- **Paths:**  
  `.cursor/skills/bugfix-planning/SKILL.md`  
  `.cursor/skills/bugfix-implementation/SKILL.md`  
  `.cursor/skills/change-verification/SKILL.md`  
  (optional thin note in `.cursor/commands/plan-fix.md` / `implement-fix.md` / `verify-fix.md` only if adding HTTP wording)
- **Responsibilities:** Explicit rule that bugfixes adding/changing HTTP endpoints update OpenAPI + Postman.
- **ACs:** AC-05 (extended), open question 3 recommendation
- **Verify:** Static inspection of skill text.

### Phase 5 — Full gates

- **ACs:** AC-07, AC-08
- **Verify:** commands in Full verification below; confirm no production controller/`main.ts` behavior diffs beyond intended test/docs/rules.

## Dependency and compatibility impact

- **No new runtime npm dependencies.**
- **Additive** documentation/tooling; OpenAPI remains canonical machine contract.
- Agent process gains an extra mandatory artifact for HTTP changes (backward compatible with existing OpenAPI obligations).
- Release archive automatically includes `docs/postman/**` once tracked; no policy change required.
- Lockfile: **unchanged**.

## Targeted verification

```bash
npm run test:unit -- --testPathPatterns=postman-coverage
npm run test:postman-coverage
npm run test:unit -- --testPathPatterns=openapi-contract
npm run lint
```

Static:

- Diff review: only docs/postman, agent rules/skills/commands, AGENTS/task README, package.json script, openapi postman-coverage spec.
- Confirm collection path inventory equals OpenAPI `expectedRoutes`.
- Grep collection/env for forbidden patterns (real `eyJ` JWTs, `AKIA…`, private key blocks, non-localhost production URLs if any slipped in).

## Full verification

```bash
npm run lint
npm run test:unit
```

Optional (not required for AC-07): `npm run build:api` — no production compile impact expected; run if implementer wants belt-and-suspenders after adding the API-side spec file.

Bootstrap / Newman / live Postman UI import are **not** merge gates; human may spot-check import.

Release: no mandatory `release:check` unless implementer wants confidence that secret scan still passes on the new JSON (recommended once if easy).

## Acceptance criteria mapping

| AC | Phase | Verification |
| --- | --- | --- |
| **AC-01** Collection v2.1 exists / importable structure | 1–2 | File presence + schema assert in `postman-coverage.spec.ts` |
| **AC-02** Env/variable template without secrets | 1 | Inspect `local.postman_environment.json` + collection `variable[]` |
| **AC-03** All Auth/Google/Sessions/Health routes correct | 1–2 | Inventory + coverage unit test vs OpenAPI |
| **AC-04** `docs/postman/README.md` import/variables | 1 | File inspection |
| **AC-05** Agent rules/skills/commands/DoD require Postman | 3–4 | Diff inspection of listed agent files |
| **AC-06** Verification includes Postman drift | 2–3 | `task-verification` (+ bugfix verification) wording + coverage command |
| **AC-07** No production behavior change outside in-scope docs/rules/scripts/tests | 5 | `git diff` scope review |
| **AC-08** Lint + clear npm invocation for new script | 2, 5 | `npm run lint`; `npm run test:postman-coverage` |

## Rollout strategy

1. Merge docs + coverage test + agent rule updates.
2. Next HTTP task/bugfix must update `docs/postman/…collection.json` in the same PR; coverage unit test fails if a new OpenAPI route is missing from Postman.
3. Integrators import collection + env from `docs/postman/README.md`.

## Rollback strategy

1. Revert the TASK-002 commit(s) (collection, coverage test, rule text, npm script).
2. OpenAPI-only agent process remains as before.
3. No database or runtime rollback.

## Risks

| Risk | Mitigation |
| --- | --- |
| Postman URL templates diverge from OpenAPI `{param}` syntax | Normalize `{id}` / `{{sessionId}}` in coverage matcher; document convention in README |
| Collection drifts while OpenAPI updated first | Coverage test fails on `test:unit` |
| Agents update only task workflow, forget bugfixes | Phase 4 + rule bullet explicitly covers bugfix HTTP changes |
| Secret scan / humans paste real tokens into committed JSON | Empty defaults; README warning; verification checklist; optional assert empty token vars |
| Google callback not useful in Postman (browser redirect) | Still include request for inventory completeness; README notes browser/OAuth limitation |
| Heavy CI / Postman CLI temptation | Explicitly out of scope; Jest-only coverage |

## Open questions requiring human decision

These match the approved specification. Recommendations below are **planner proposals**; human plan approval should confirm or override them before implementation.

1. ~~Canonical path: `postman/` vs `docs/postman/`?~~ **Decided:** `docs/postman/`.

2. **Automated OpenAPI↔Postman coverage check vs checklist-only for v1?**  
   **Recommendation:** **Add** the lightweight Jest coverage spec (`apps/api/src/openapi/postman-coverage.spec.ts`) + `npm run test:postman-coverage` alias. No Postman CLI/Newman. Checklist language remains in the verification skill as a supplement (changed-route spot check + no secrets), not as the only control.

3. **Should bugfix HTTP endpoint changes share the same Postman obligation?**  
   **Recommendation:** **Yes.** Update bugfix planning/implementation/verification skills (and the new-task delivery rule wording) so HTTP add/change in bugfixes updates OpenAPI **and** Postman in the same change set.

If any recommendation is rejected, revise this plan before implementation (do not invent an alternate approach silently).
