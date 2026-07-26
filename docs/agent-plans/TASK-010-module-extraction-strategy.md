---
task_id: TASK-010
specification: docs/agent-tasks/TASK-010-module-extraction-strategy.md
status: approved
owner: human-approval-required
---

# TASK-010 — Implementation plan

## Approved specification

- Source: `docs/agent-tasks/TASK-010-module-extraction-strategy.md` (frontmatter `status: approved`).
- Goal: one truthful, actionable module-reuse strategy — either **(A) publishable packages** or **(B) documented copy-kit** — plus corrected registration-matrix documentation; no module-internals refactor (those are TASK-007/008/009); no runtime/OpenAPI change.
- Functional requirements FR-01…FR-07 and non-functional NFR-01…NFR-04 as written.
- Open questions in the specification (model A vs B, registry scope, packaging slice, sequencing, archive flow) require human decision; this plan **recommends B** and treats plan approval as approval of that choice (see Architecture decision and Open questions).

## Current implementation

Inspected on the current branch (2026-07-25). Working tree also contains staged/unstaged **TASK-009** Events/Outbox wiring changes; TASK-007/008 are already on `HEAD`.

### Packaging / reuse reality

| Fact                     | Evidence                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Root package is private  | `package.json`: `"private": true`; no `workspaces`, no `publishConfig`                                                 |
| No per-lib manifests     | `libs/**/package.json` — **none**                                                                                      |
| Path-alias monorepo      | `tsconfig.json` paths: `@domain/*`, `@application/*`, `@contracts/*`, `@infrastructure/*`, `@shared/*`                 |
| Nest CLI apps only       | `nest-cli.json` projects: `api`, `worker`, `cron`, `migrations` — no library projects                                  |
| Release = source archive | `scripts/release/build-archive.ts` → `git archive` zip; `npm run release:archive` / `release:verify` / `release:check` |
| Product positioning      | `README.md` L5: foundation you **copy** into a new project                                                             |

This matches the High finding in `docs/agent-reports/full-review-2026-07-20.md`: reuse today is copy/fork/archive, not `npm install @org/<module>`.

### Registration reality (post TASK-007 / TASK-008 / TASK-009 on branch)

| Style                        | Modules                                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forRoot` / `forRootAsync`   | `LoggerModule`, `RedisModule`, `DrizzleModule`, `InfrastructureBullMqModule` (+ `registerQueues`), `AuthModule`, `GoogleSsoModule`, `MailModule`, `StorageModule`, `OutboxProcessorOptionsModule`, `OutboxProcessorModule`, deprecated `InfrastructureModule.forRoot` |
| `register` / `registerAsync` | `HealthModule`, `RateLimiterModule`                                                                                                                                                                                                                                   |
| `register` only              | `CacheModule`, `LocksModule`, `IdempotencyModule`, `EventsModule`, `AuditModule`, `TransactionsModule`, `RepositoriesModule`, `OutboxWriterModule`                                                                                                                    |
| Static `@Module`             | `ExceptionsModule`, `InfrastructureConfigModule`                                                                                                                                                                                                                      |
| Deprecated convenience       | `*Module.forRootFromAppConfig` on Redis/Drizzle/BullMQ/Auth/Mail/Storage                                                                                                                                                                                              |

`EventsModule.register({ imports?, handlers? })` after TASK-009 — no baked-in `UserRegisteredHandler`.

### Doc overclaim (must fix — FR-04 / AC-03)

- `docs/infrastructure-modules/README.md` L3: “Each reusable infrastructure module exposes typed `forRoot` / `forRootAsync`” — **false**.
- `EXAMPLES.md` §13: claims every portable module listed registers via `forRoot` / `forRootAsync` — incomplete list and overclaim.
- `README.md` correctly says “copy into a new project” in places, but still points at the overclaiming infrastructure README without a registration matrix or extraction guide.

### Related work on branch

- TASK-007/008 landed (`LoggerModule.forRoot*`, `RateLimiterModule.register*`).
- TASK-009 implementation present in working tree (Events handlers injectable; sample handler under `events/examples/`). Plan for TASK-010 should document the **matrix as of implementation time** (prefer post-009).

## Architecture decision

**Choose model (B) — documented copy-kit**, not publishable npm packages, for this task iteration.

### Rationale

1. **Truthful product model:** README and `scripts/release/*` already ship a **source-archive / copy** reuse story. Documenting that as the official contract removes the portability overclaim without inventing a packaging system the repo does not have.
2. **Risk vs benefit:** Introducing workspaces + per-lib `package.json` + export maps (model A) touches resolution, lockfile (NFR-01), and Nest build paths. Spec FR-06 forbids runtime behavior change; packaging accidents often break apps even when intended to be additive. Copy-kit is additive docs + decision record only.
3. **AC-07 without packaging:** A reviewer can follow per-module copy steps into a scratch Nest project and register via the documented API — no need for `npm pack` in this iteration.
4. **Deferred A:** Full packaging (workspaces, versioned packages, optional registry) remains a valid **future** task once the copy-kit matrix and peer notes are stable. Spec open question 2 already allows “pack-able later”; choosing B now does not forbid A later.

**Approving this plan means approving model B for TASK-010.** If the human wants A instead, reject/supersede this plan and request a packaging-focused revision before any implementation.

### What “copy-kit” delivers

1. A committed **decision record** stating B + rationale (AC-01).
2. A **per-module extraction guide** covering registration API, peers/tokens, config touchpoints, and copy steps for every reusable infrastructure module (AC-02-B, AC-07).
3. An accurate **registration matrix** in `docs/infrastructure-modules/README.md` and corrected README/EXAMPLES claims (AC-03).
4. Explicit statement that libs are **path-alias source modules**, not published packages; release remains `git archive` (open question 5 → keep).

## Scope

- Decision record: reuse model = documented copy-kit (B).
- Extraction / reuse guide with per-module dependency and registration notes.
- Correct registration matrix and remove “every module has `forRoot`” claims.
- Light README/EXAMPLES wording so “portable” means “copy-kit extractable with typed registration,” not “npm install.”
- Keep existing alias builds and archive release flow unchanged.
- Document matrix reflecting TASK-007/008/009 outcomes present at implementation time.

## Out of scope

- Introducing npm workspaces, per-lib `package.json`, export maps, or registry publish CI (model A).
- Refactoring module registration APIs (TASK-007/008) or Events internals (TASK-009) beyond documenting their public APIs.
- Changing runtime behavior of API/Worker/Cron/Migrations.
- Any HTTP/OpenAPI change.
- Replacing or removing `scripts/release/*` archive flow.
- Broad README rewrite beyond reuse-model + matrix accuracy.
- Making feature modules grow `forRoot` where they only have `register` today.

## Files to create

| Path                                              | Purpose                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs/architecture/ADR-001-module-reuse-model.md` | Decision record: choose B (copy-kit), rationale, consequences, non-goals (AC-01)                  |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md` | Per-module extraction guide: peers, tokens, registration API, config, copy steps (AC-02-B, AC-07) |
| `docs/agent-reports/TASK-010-implementation.md`   | Implementer evidence report (commands + matrix cross-check)                                       |

Optional (only if implementer finds INDEX pattern expects it): short pointer row is enough; do not create duplicate ADR elsewhere.

## Files to modify

| Path                                    | Change                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/infrastructure-modules/README.md` | Replace universal `forRoot` claim with registration matrix + link to EXTRACTION_GUIDE; keep existing per-module `forRoot` examples for modules that actually have them; add brief notes for `register` / static modules |
| `EXAMPLES.md`                           | §13: stop claiming every listed module uses `forRoot`; point to matrix + extraction guide; list representative `register` examples where helpful                                                                        |
| `README.md`                             | Clarify reuse model = copy/archive (not npm packages); link ADR + EXTRACTION_GUIDE + infrastructure README matrix; remove/soften any wording that implies publishable libs                                              |
| `docs/agent-plans/INDEX.md`             | Add TASK-010 row (`proposed` until human approval)                                                                                                                                                                      |
| `docs/agent-tasks/INDEX.md`             | No status change by implementer; optional note only if parent already tracks — do not invent workflow status columns                                                                                                    |

## Files to delete

None.

## Domain changes

None.

## Application changes

None.

## Contract and DI changes

None in production code. Guide must **document** existing contracts/tokens consumers need when extracting (e.g. `TOKENS.*` from `@contracts/tokens`, queue contracts, options symbols such as `LOGGER_MODULE_OPTIONS`, `RATE_LIMITER_MODULE_OPTIONS`).

## Infrastructure changes

None in production TypeScript. Documentation only, sourced from current `*.module.ts` APIs.

## Interface and entrypoint changes

None. Entrypoint builds must remain unchanged (FR-05, FR-06).

## Database and migration changes

None.

## Security and authorization changes

None. Guide must warn: do not copy `.env` / secrets; copy schema/options mapping patterns only.

## Observability changes

None.

## Implementation phases

### Phase 1 — Decision record (AC-01)

- Create `docs/architecture/ADR-001-module-reuse-model.md` with:
  - Context (private package, path aliases, archive release, overclaim).
  - Decision: **B — documented copy-kit**.
  - Consequences: reuse = copy source folders + wire peers; no npm package consumption in this repo iteration; packaging deferred.
  - Non-goals: registry publish, workspaces, replacing archive release.
- Verification: file exists; states B explicitly; rationale matches this plan.

### Phase 2 — Registration matrix in infrastructure README (AC-03, FR-04, NFR-03)

- Edit `docs/infrastructure-modules/README.md`:
  - Remove L3 universal `forRoot` sentence.
  - Add a table: Module | Registration API | Notes (peers / global / deprecated helpers).
  - Cross-check every row against actual `libs/infrastructure/src/**/*.module.ts` at implementation time (include Logger `forRoot*`, RateLimiter `register*`, Events `register({ handlers })` if TASK-009 is on branch).
  - Link to `EXTRACTION_GUIDE.md`.
  - Keep existing Redis/Drizzle/BullMQ/Auth/Mail/Storage examples; add short stubs or links for Logger, Health, RateLimiter, Events, static Exceptions/Config.
- Verification: grep docs for “Every reusable” / “Each reusable.*forRoot”; matrix rows match source (`static forRoot` / `static register` / no dynamic method).

### Phase 3 — Extraction guide (AC-02-B, AC-07, FR-03)

- Create `docs/infrastructure-modules/EXTRACTION_GUIDE.md` covering **every reusable infrastructure module** in the matrix, plus required neutral layers:
  - Always copy with an infra module when needed: relevant `@contracts/*` tokens/ports, `@domain/*` types the module imports, `@shared/*` utilities it imports (list per module by inspecting imports — do not invent).
  - Per module sections: registration API; required peer modules / inject tokens; config options type + env/mapper touchpoints (`create-starter-kit-module-options` vs typed options only); suggested copy file set (directory paths); composition-root registration snippet; “do not copy” notes (e.g. `events/examples/*` sample only; deprecated `forRootFromAppConfig` optional).
  - Foundation order: contracts/domain/shared → Logger → Redis/Drizzle/BullMQ → feature adapters → Auth/Mail/Storage/Outbox → Health.
  - Explicit “families”: Redis-backed adapters; Drizzle-backed adapters; Outbox = processor + writer + events + audit peers.
  - Scratch-project dry-run checklist for **one** module (recommend `RedisModule` or `LoggerModule`): copy paths, path-alias or relative import rewrite, register API, compile — without editing module internals (AC-07).
- Verification: every matrix module has a section; dry-run checklist is executable by a reviewer.

### Phase 4 — README / EXAMPLES alignment (AC-03)

- `README.md`: state copy-kit / archive reuse; link ADR + guide + matrix; avoid implying npm-publishable libs.
- `EXAMPLES.md` §13: accurate registration language; link matrix/guide.
- Verification: no remaining claim that every reusable module has `forRoot`.

### Phase 5 — Implementer evidence (AC-04…AC-06)

- Run builds/lint (see Full verification).
- Confirm `git diff` has no OpenAPI/controller/schema changes and no production `libs/**` or `apps/**` code changes.
- Confirm `package-lock.json` untouched.
- Write `docs/agent-reports/TASK-010-implementation.md` with command results and matrix cross-check notes.
- Verification: report lists commands + conclusions; AC checklist marked against evidence.

## Dependency and compatibility impact

- **No** dependency or lockfile changes (NFR-01).
- **No** import-style migration (NFR-04) — aliases unchanged.
- Dependency direction unchanged (NFR-02) — documentation only.
- Archive release flow **kept** (open question 5).

## Targeted verification

```bash
# Docs accuracy — registration APIs in source
rg "static forRoot|static register|@Module\(" libs/infrastructure/src --glob "*.module.ts"

# Overclaim hunt
rg -i "each reusable|every reusable|every portable|forRoot.*every|кожен переносимий" docs README.md EXAMPLES.md

# No production code / OpenAPI / lockfile in TASK-010 diff (after implementation)
git diff --name-only
```

Manual: follow EXTRACTION_GUIDE dry-run for one module (Logger or Redis) into a scratch folder — copy listed paths, register via documented API, confirm no need to edit copied module internals (AC-07). Scratch project need not be committed.

## Full verification

```bash
npm run build
npm run build:api
npm run build:worker
npm run build:cron
npm run build:migrations
npm run lint
```

Optional (docs-only change; still recommended if time permits):

```bash
npm run test:unit
npm run release:check
```

Record each as: command, result, conclusion. Expect builds/lint green with **zero** production code changes. `package-lock.json` must not change.

## Acceptance criteria mapping

| AC        | Phase       | Verification                                                                                                |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| AC-01     | Phase 1     | Inspect ADR states model B + rationale                                                                      |
| AC-02 (B) | Phase 3     | EXTRACTION_GUIDE covers every reusable module: API, peers/tokens, config                                    |
| AC-03     | Phases 2, 4 | Matrix in infrastructure README; README/EXAMPLES no universal `forRoot` claim; cross-check vs `*.module.ts` |
| AC-04     | Phase 5     | `npm run build` + per-entrypoint builds succeed                                                             |
| AC-05     | Phase 5     | `npm run lint` succeeds; lockfile unchanged                                                                 |
| AC-06     | Phase 5     | Diff review — no OpenAPI changes                                                                            |
| AC-07     | Phase 3     | Reviewer dry-run checklist for one module without editing that module’s internals                           |

## Rollout strategy

- Additive documentation and ADR only.
- No deployment order change; no feature flags.
- Prefer completing after TASK-009 is merged/accepted so the Events row matches shipped code; if implementing while TASK-009 is only on the branch, document branch reality and note sequencing in the implementer report.

## Rollback strategy

- Revert the doc/ADR commit(s). Apps and lockfile unaffected.

## Risks

| Risk                                               | Mitigation                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Matrix drifts from TASK-009 mid-flight             | Implement against actual `*.module.ts` at implementation time; cite commit/branch state in report |
| Extraction guide incomplete peers → failed dry-run | Derive peers from constructor/`imports` in module source; dry-run one module during verification  |
| Human expected model A                             | Plan approval = B; if A desired, supersede plan before coding                                     |
| Over-editing README                                | Limit README edits to reuse-model clarity + links                                                 |

## Open questions requiring human decision

Resolved by **this plan’s recommendation** (confirm on plan approval):

1. **Model choice:** **B — documented copy-kit** (not A). Approving this plan approves B for TASK-010.
2. **Registry / pack:** Out of scope this iteration (no `npm pack` packaging work).
3. **Packaging slice:** N/A under B.
4. **Sequencing vs TASK-007/008/009:** Document **current** matrix including 007/008 and 009-if-present; do not wait for further refactors; do not change module internals here.
5. **Archive release:** **Keep** `scripts/release/*` as the official distribution mechanism; document it as part of the copy-kit story.

If any of 1–5 should differ, do **not** approve this plan as-is — request a revised plan (especially for model A).
