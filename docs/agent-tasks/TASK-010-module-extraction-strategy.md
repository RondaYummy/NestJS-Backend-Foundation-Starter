---
task_id: TASK-010
task_type: infrastructure
status: approved
owner: human-approval-required
---

# TASK-010 — Module reuse / extraction strategy (packaging vs documented copy-kit)

## Original request

Створити завдання на всі High-проблеми з рев'ю переносимості
(`docs/agent-reports/full-review-2026-07-20.md`). Ця задача покриває High-проблему:
немає publishable packages / extraction story — reuse наразі можливий лише через
copy/fork, а документація завищує рівень переносимості.

## Problem or opportunity

The starter claims "portable, reusable backend foundation" and
`docs/infrastructure-modules/README.md` states that each reusable module exposes
typed `forRoot`/`forRootAsync`. In practice:

- root `package.json` is `"private": true` with no `workspaces` and no
  `publishConfig`;
- there are no `libs/*/package.json` files — libs are TypeScript path aliases
  (`@infrastructure/*`, `@contracts/*`, ...) only;
- `nest-cli.json` monorepo config lists apps, not publishable library projects;
- release tooling (`scripts/release/*`) ships source archives, not npm packages.

So "reuse across projects" today means copy/fork the repo, not
`npm install @org/<module>`. Additionally the docs overstate the `forRoot` coverage
(Logger/Exceptions are static; many feature modules are `register`-only — see
TASK-007/008). Integrators are misled about the actual reuse model.

Infrastructure/documentation task. This task decides and documents/implements the
reuse model; it does not itself refactor module internals (those are TASK-007/008/009).

## Goal

The repository has a single, truthful, and actionable module-reuse strategy. Either
(a) the libs become extractable/publishable packages with a documented workflow, or
(b) the project explicitly documents a "copy-kit" reuse model with concrete
extraction steps and per-module dependency notes. In both cases, portability
documentation is corrected to match the actual `forRoot`/`register`/static reality.

## Users and actors

- Integrators wanting to reuse one or more modules in a different codebase.
- Maintainers deciding release/versioning strategy.
- Reviewers verifying documentation-vs-reality accuracy.

## Current system context

Inspected on the current branch:

- `package.json` — `"private": true`; no `workspaces`, `publishConfig`, or
  per-lib package metadata.
- `tsconfig.json` — path aliases `@domain/*`, `@application/*`, `@contracts/*`,
  `@infrastructure/*`, `@shared/*`.
- `nest-cli.json` — monorepo with app projects; libs compiled via aliases.
- `docs/infrastructure-modules/README.md` — L3 claims every reusable module exposes
  typed `forRoot`/`forRootAsync`; examples cover only Redis/Drizzle/BullMQ/Auth/
  Mail/Storage.
- Registration reality: `forRoot`/`forRootAsync` on Redis, Drizzle, BullMQ, Auth,
  GoogleSso, Mail, Storage, Outbox; `register`/`registerAsync` on Health;
  `register`-only on Cache/Locks/Idempotency/RateLimiter/Events/Audit/Transactions/
  Repositories; static `@Module` on Logger/Exceptions/InfrastructureConfig.
- `scripts/release/*` (e.g. `build-archive.ts`, `verify-archive.ts`) — source
  archive release flow.

## Functional requirements

- **FR-01:** Produce a single decision record for the reuse model:
  **(A) publishable packages** or **(B) documented copy-kit** (the choice is an
  Open question requiring human decision; the task delivers whichever is approved).
- **FR-02 (if A — packaging):** Add the minimum viable packaging so at least the
  provider-neutral layers (`contracts`, `domain`, `shared`) and selected
  infrastructure modules can be built and consumed as versioned packages
  (workspaces and/or per-lib `package.json`, build outputs, exports maps), without
  breaking existing apps/aliases and builds.
- **FR-03 (if B — copy-kit):** Add a documented extraction guide describing, per
  reusable module, its required peer modules/tokens, its registration API
  (`forRoot`/`register`/static), env/config touchpoints, and copy steps, so a module
  can be lifted into another project deterministically.
- **FR-04:** Correct `docs/infrastructure-modules/README.md` and any README/EXAMPLES
  claims so the registration matrix (which modules have `forRoot` vs `register` vs
  static) is accurate.
- **FR-05:** Keep all existing entrypoint builds working
  (`npm run build`, `build:api`, `build:worker`, `build:cron`, `build:migrations`).
- **FR-06:** No production runtime behavior change to API/Worker/Cron/Migrations.
- **FR-07:** OpenAPI/HTTP contracts unaffected.

## Non-functional requirements

- **NFR-01:** Do not change `package-lock.json` unless dependency/workspace changes
  are intentional and part of the approved plan.
- **NFR-02:** Preserve the enforced dependency direction
  (domain <- application <- ... , infrastructure -> contracts).
- **NFR-03:** Documentation must be verifiable against code (registration matrix
  must match actual module APIs at the time of the task).
- **NFR-04:** Any packaging must not force apps to change import style unnecessarily
  (aliases and/or package names must both resolve, or a documented migration).

## Public API and interface impact

Potentially adds package manifests/export maps (if A). No HTTP/SDK/CLI runtime
contract change.

### HTTP API contract (if applicable)

Not applicable.

- Methods and paths: none
- Request/response/validation: none
- Status codes and error envelope: none
- Auth: none
- Headers/cookies: none
- OpenAPI schemas/decorators to add or update: **none — OpenAPI unaffected**
- Acceptance criterion verifying generated OpenAPI: **N/A**

## Data model and migration impact

None.

## Events, queues and background processing

None.

## Security and authorization

- Any publishing workflow (if A) must not publish secrets; `.npmignore`/`files`
  must exclude env and local artifacts.

## Entrypoints and deployment impact

| Entrypoint                 | Impact                                                          |
| -------------------------- | --------------------------------------------------------------- |
| API/Worker/Cron/Migrations | Must keep building and running unchanged                        |
| Release tooling            | May gain packaging steps (if A) or documentation updates (if B) |

## Observability and operations

- No runtime observability change.

## Compatibility requirements

- Existing `@infrastructure/*` etc. aliases must keep resolving for apps.
- Existing archive release flow must remain functional unless the approved plan
  replaces it.

## Dependencies

- Interacts with TASK-007/008/009: the accurate registration matrix (FR-04) should
  reflect their outcomes if they land first, but this task can document the current
  state and be updated. Sequencing is an open question.

## Assumptions

- **A-01:** Infrastructure/documentation task; module internals are refactored by
  TASK-007/008/009, not here.
- **A-02:** Full npm publishing to a registry may be out of scope for a first
  iteration; "extractable/consumable" is the minimum bar (open question).
- **A-03:** Parent agent updates `docs/agent-tasks/INDEX.md`.

## Out of scope

- Refactoring module registration APIs (TASK-007/008) or Events wiring (TASK-009).
- Setting up a specific private registry / CI publish pipeline unless explicitly
  approved.
- Changing runtime behavior of any entrypoint.
- Any HTTP/OpenAPI change.

## Acceptance criteria

- **AC-01:** A committed decision record states the chosen reuse model (A or B) with
  rationale.
- **AC-02 (A):** At least the neutral layers (`contracts`/`domain`/`shared`) plus
  one infrastructure module are buildable/consumable as versioned packages, verified
  by a documented build/pack command; **or (B):** a per-module extraction guide
  exists covering registration API, required peers/tokens, and config touchpoints
  for every reusable module.
- **AC-03:** `docs/infrastructure-modules/README.md` (and README/EXAMPLES where
  relevant) contains an accurate registration matrix; no claim that "every" module
  has `forRoot` when it does not.
- **AC-04:** `npm run build` and all per-entrypoint builds still succeed.
- **AC-05:** `npm run lint` succeeds; `package-lock.json` changes only if
  intentional and explained.
- **AC-06:** No OpenAPI changes in the diff.
- **AC-07:** A reviewer can follow the documented steps to reuse one module in a
  scratch project (or dry-run pack) without editing that module's internal source.

## Verification strategy

- Static: diff review of manifests/docs; cross-check registration matrix against
  actual module source.
- Build: `npm run build` + per-entrypoint builds; if A, run the documented
  `pack`/build command for a sample package.
- Reuse check: follow the extraction/consumption steps for one module (copy-kit
  steps or `npm pack` + install in a scratch dir) and confirm it registers via its
  documented API without source edits.
- Commands: `npm run build`, `npm run lint`.

## Rollout and rollback

- **Rollout:** Additive (manifests/docs); no runtime change.
- **Rollback:** Revert packaging/doc commit; apps unaffected.
- **Risk:** Introducing workspaces/manifests can break build resolution or the
  lockfile; mitigate by keeping aliases working and gating on full build.

## Open questions requiring human decision

1. **Model choice:** (A) publishable packages/workspaces vs (B) documented copy-kit
   with extraction guide? (Primary decision.)
2. If A: publish to a real registry now, or only make libs `npm pack`-able /
   workspace-consumable for this iteration?
3. Scope of first packaging slice: only neutral layers
   (`contracts`/`domain`/`shared`), or also bundle top infrastructure modules?
4. Sequencing relative to TASK-007/008/009 (document current matrix now vs wait for
   their refactors to land)?
5. Keep or replace the existing source-archive release flow (`scripts/release/*`)?
