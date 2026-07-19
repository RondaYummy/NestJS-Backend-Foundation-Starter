---
task_id: TASK-002
specification: docs/agent-tasks/TASK-002-migration-parity-matrix.md
status: approved
owner: human-approval-required
---

# TASK-002 — Implementation plan

## Approved specification

`docs/agent-tasks/TASK-002-migration-parity-matrix.md` (frontmatter `status: approved`).

## Current implementation

- No migration catalog exists today. `docs/agent-tasks/` holds only task specifications and `MIGRATION_PROGRAM.md`; there is no `docs/migration/` directory.
- `docs/agent-tasks/INDEX.md` lists `TASK-002` with `Status: proposed` (row 7) — stale relative to the specification's approved frontmatter.
- `docs/agent-tasks/MIGRATION_PROGRAM.md` line 99 states "All migration task specifications are currently `proposed`." — stale; every `TASK-003…021` specification frontmatter already reads `status: approved` (spot-checked: `TASK-003-auth-v1-parity.md`, `TASK-004-users-profile-v1.md`; consistent with the rest of the series per `INDEX.md`/`MIGRATION_PROGRAM.md` narrative).
- `MIGRATION_PROGRAM.md` has no link to a matrix file; line 30 only says "produced by TASK-002" with no path.
- Inventory confirmed by direct inspection of `OLD_BACKEND/src/v1/*` and related services (matches the human-provided inventory in full):
  - 12 controllers, 67 routes total, all controllers use `@Controller('v1'...)`-style paths (no global prefix is set in `OLD_BACKEND/src/main.ts`):
    - `OLD_BACKEND/src/v1/v1-campaigns.controller.ts` — 8 routes
    - `OLD_BACKEND/src/v1/v1-comments.controller.ts` — 4 routes
    - `OLD_BACKEND/src/v1/v1-services.controller.ts` — 1 route
    - `OLD_BACKEND/src/v1/auth/v1.auth.controller.ts` — 8 routes
    - `OLD_BACKEND/src/v1/v1-admin.controller.ts` — 10 routes
    - `OLD_BACKEND/src/v1/v1-workers.controller.ts` — 2 routes
    - `OLD_BACKEND/src/v1/v1.controller.ts` — 9 routes (verified directly: `status`, `privatbank-exchange`, `profile`, `city/:limit`, `user-city`, `push-subscribe`, `push-unsubscribe`, `feedback`, `utils/aggregate-search`)
    - `OLD_BACKEND/src/v1/v1-users.controller.ts` — 9 routes
    - `OLD_BACKEND/src/v1/v1-appointments.controller.ts` — 2 routes
    - `OLD_BACKEND/src/v1/v1-campaigns-admin.controller.ts` — 11 routes
    - `OLD_BACKEND/src/v1/v1-campaigns-vip.controller.ts` — 1 route
    - `OLD_BACKEND/src/v1/v1-schedule.controller.ts` — 2 routes
  - Socket.IO: `OLD_BACKEND/src/v1/sockets/notifications.gateway.ts`.
  - Crons: `OLD_BACKEND/src/services/ranking-system.service.ts` (3 `@Cron` schedules), `OLD_BACKEND/src/services/admins.service.ts::clearOldLogs` (1 `@Cron` schedule).
  - Push: `OLD_BACKEND/src/configs/webpush.ts`, `OLD_BACKEND/src/v1/pushMessages/push-messages.service.ts` (plus call sites in `v1-admin.controller.ts`, `admins.service.ts`, `env.validation.ts`, `main.ts` bootstrap).
  - Mail: `OLD_BACKEND/src/mail/mail.service.ts`.
  - S3: `OLD_BACKEND/src/services/aws-s3.service.ts`.
  - Fondy: `OLD_BACKEND/src/services/payments/payments.service.ts` — exists but commented out of the root module registration (D5 as-is; no HTTP routes to catalog).
  - Entities (11 tables): `OLD_BACKEND/src/entities/{notification,feedback,token,appointment,push-subscribe,city,service,comment,restore-password,user,campaign}.entity.ts`.
- Working tree is otherwise unrelated to this plan file; however, `docs/agent-tasks/INDEX.md` already has a **pre-existing staged** change (not produced by this planning pass) that bulk-sets Status to `approved` for **TASK-002…021**. That staged diff **conflicts with decision 5A** (Phase 6 must change only the TASK-002 row). Before implementing Phase 6, a human must unstage/adjust that INDEX change so the implementer can apply the single-row update only.

## Architecture decision

This is a documentation-only task (`NFR-02`); there is no application/domain/infrastructure architecture decision. The only structural decision is catalog placement and shape, resolved by human decision below (Option B/B): a new `docs/migration/` directory with five purpose-scoped files instead of one flat file or reuse of `docs/agent-tasks/`. Rationale: keeps the living, growing parity catalog separate from static task specifications, gives the HTTP matrix (the AC-01/AC-02 binding artifact) its own reviewable file, and lets side effects / entities / D6 breaks evolve independently without bloating one document.

## Scope

- Create `docs/migration/README.md`, `docs/migration/HTTP_PARITY_MATRIX.md`, `docs/migration/SIDE_EFFECTS.md`, `docs/migration/ENTITIES_ETL.md`, `docs/migration/D6_BREAKS.md`.
- Populate the HTTP matrix with all 67 OLD routes across the 12 controllers, each row mapped to a TASK owner ID.
- Document Socket.IO events, cron jobs, push/mail/S3 call sites, and Fondy as-is status in `SIDE_EFFECTS.md`.
- Document the 11 legacy entities/tables with JSONB notes in `ENTITIES_ETL.md`.
- Document the explicit D6 break list in `D6_BREAKS.md`.
- Record legacy-observed cookie/header transport in the HTTP matrix per FR-06 (legacy names only; target names explicitly deferred to TASK-003).
- Update `docs/agent-tasks/INDEX.md` TASK-002 row Status to `approved`.
- Fix the stale sentence in `docs/agent-tasks/MIGRATION_PROGRAM.md` and add a link to `docs/migration/README.md`.

## Out of scope

- Bulk-updating `INDEX.md` status for `TASK-003…021` (explicitly excluded by human decision 5A).
- Editing `TASK-003-auth-v1-parity.md` or any other task specification (its open question about cookie names stays intact).
- OpenAPI generation, runtime code, ETL scripts, or any production code change (`NFR-02`, spec "Out of scope").
- Freezing target cookie/header names (deferred to TASK-003 per FR-06 decision 3A).

## Files to create

- `docs/migration/README.md` — catalog index; states that `HTTP_PARITY_MATRIX.md` is the contract source of truth for "same as OLD" behavior (per spec "Compatibility requirements"); links to the other four files; summarizes D1–D6 locked decisions by reference (not duplicated) to `MIGRATION_PROGRAM.md`.
- `docs/migration/HTTP_PARITY_MATRIX.md` — AC-01/AC-02 binding artifact. One table section per controller (12 sections), one row per route (67 rows total). Compact-row columns (human decision 4C): `Method`, `Path`, `Auth`, `Key request fields`, `Success shape (top-level fields)`, `Known error behavior`, `TASK owner`, `D6 flag`. Full example JSON blocks only for high-risk contracts: `/v1/auth/*` (8 routes in `v1.auth.controller.ts`), `/v1/profile` (in `v1.controller.ts`), and other auth-sensitive identity responses discovered while transcribing `v1-users.controller.ts` (e.g. profile-adjacent user routes). A dedicated "Auth transport (legacy observed)" section records `auth-cookie` / `refresh-cookie` (httpOnly, `sameSite=lax`), JWT accepted from cookie or `Authorization: Bearer`, refresh cookie used only for the refresh route, and a note that target cookie names are **deferred to TASK-003** (FR-06 / decision 3A).
- `docs/migration/SIDE_EFFECTS.md` — non-HTTP contracts (FR-02, FR-03): Socket.IO events/auth handshake from `notifications.gateway.ts`; the 4 cron schedules (3 in `ranking-system.service.ts`, 1 `clearOldLogs` in `admins.service.ts`) with expressions and TASK owners (`TASK-013`, `TASK-014`); push flow via `webpush.ts` / `push-messages.service.ts` mapped to `TASK-016`; mail triggers via `mail.service.ts` mapped to owning feature tasks (e.g. `TASK-003`/`TASK-004` for auth/restore-password mail, others as discovered); S3 upload call sites via `aws-s3.service.ts` mapped to `TASK-006` (wiring) plus owning feature tasks for each call site; Fondy documented as D5 as-is with no HTTP routes, owner `TASK-018`.
- `docs/migration/ENTITIES_ETL.md` — table inventory (FR data model impact): all 11 entities in `OLD_BACKEND/src/entities/`, one row per entity with table name, key columns, relations, and any JSONB column notes relevant to `TASK-020` ETL.
- `docs/migration/D6_BREAKS.md` — AC-03 binding artifact: explicit list of intentional security/correctness breaks (FR-05) — password hash leaks / missing response sanitization, comment author spoofing via request body `from`, and Error-as-200 responses (campaigns create, comments, appointments, aggregate-search, admin logs) — each with legacy behavior, new expected behavior, and owning TASK ID; explicit statement that these are NOT preserved as parity contracts.

## Files to modify

- `docs/agent-tasks/INDEX.md` — change the TASK-002 row `Status` cell from `proposed` to `approved` (AC-05, decision 5A). No other row is touched.
- `docs/agent-tasks/MIGRATION_PROGRAM.md`:
  - Fix line 99 ("All migration task specifications are currently `proposed`.") to accurately state that specifications are approved in frontmatter while their planning/implementation status is tracked per-task in `INDEX.md`.
  - Update the "Source of truth" section (line 30, currently "API parity checklist: produced by **TASK-002** and updated as slices land.") to link directly to `docs/migration/README.md` (AC-04).
  - No other section of `MIGRATION_PROGRAM.md` is edited.

## Files to delete

- None.

## Domain changes

- None (documentation only).

## Application changes

- None.

## Contract and DI changes

- None.

## Infrastructure changes

- None.

## Interface and entrypoint changes

- None.

## Database and migration changes

- None (this task only documents entity/table inventory for `TASK-020`; it does not create migrations).

## Security and authorization changes

- None to running code. `D6_BREAKS.md` documents (does not implement) the intended fixes.

## Observability changes

- None to running code. `SIDE_EFFECTS.md` notes the OLD admin log-file endpoint and ranking jobs for later ops review, per spec "Observability and operations".

## Implementation phases

### Phase 1 — Scaffold `docs/migration/` and index

- Paths: `docs/migration/README.md` (new).
- Symbols/responsibilities: write the index describing the five-file structure, declare `HTTP_PARITY_MATRIX.md` as the HTTP contract source of truth, list D1–D6 by reference to `MIGRATION_PROGRAM.md` (no duplication).
- Maps to: AC-04 (link target), NFR-01.
- Verification: manual review — confirm the file exists, links resolve to the other four files created in later phases, and no D-decision text is duplicated verbatim from `MIGRATION_PROGRAM.md`.

### Phase 2 — Transcribe the HTTP parity matrix (AC-01/AC-02/FR-01/FR-06)

- Paths: `docs/migration/HTTP_PARITY_MATRIX.md` (new); source-of-truth reads from all 12 controllers listed in "Current implementation" under `OLD_BACKEND/src/v1/`.
- Symbols/responsibilities: for every route decorator (`@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`) in each of the 12 controller files, record method, full path (controller `@Controller()` prefix + method path), auth guard/decorator usage (e.g. `@Auth(UserRole...)` presence/roles or public), key request fields (DTO/params/query), success shape top-level fields, known error behavior (including any Error-as-200 pattern), TASK owner per the mapping table below, and D6 flag where the route intersects a documented break. Add the "Auth transport (legacy observed)" subsection per FR-06/decision 3A. Add full example JSON only for `v1.auth.controller.ts` (8 routes), the `profile` route in `v1.controller.ts`, and other auth-sensitive identity routes in `v1-users.controller.ts` as discovered.
- TASK owner mapping used for this phase: Auth→`TASK-003`; Users/profile/restore→`TASK-004`; Cities→`TASK-005`; Storage/S3 call sites→`TASK-006` + owning feature task; Campaigns core→`TASK-007`; Campaign admin→`TASK-008`; Workers public→`TASK-009`; Schedule→`TASK-010`; Appointments→`TASK-011`; Comments→`TASK-012`; Ranking crons→`TASK-013`; Platform admin→`TASK-014`; Notifications/WS→`TASK-015`; Web Push→`TASK-016`; Feedback→`TASK-017`; Fondy→`TASK-018`; Public utilities (`status`, `privatbank-exchange`, `city`, `user-city`, `push-subscribe`/`unsubscribe` routing note, `utils/aggregate-search`)→`TASK-019`; note any row with no clear owner as `N/A` for `TASK-021` per spec guidance rather than leaving it blank.
- Maps to: AC-01, AC-02, FR-01, FR-06.
- Verification: static cross-check — count matrix rows per controller section and confirm each equals the inventory count (8/4/1/8/10/2/9/9/2/11/1/2 = 67 total); confirm every row has a non-empty TASK owner cell (grep for empty owner cells is not possible in markdown review, so manual per-row check during review); spot-check 3 rows per controller against the actual decorator/guard/DTO in the corresponding `OLD_BACKEND` controller file.

### Phase 3 — Document side effects (FR-02/FR-03)

- Paths: `docs/migration/SIDE_EFFECTS.md` (new); sources: `OLD_BACKEND/src/v1/sockets/notifications.gateway.ts`, `OLD_BACKEND/src/services/ranking-system.service.ts`, `OLD_BACKEND/src/services/admins.service.ts`, `OLD_BACKEND/src/configs/webpush.ts`, `OLD_BACKEND/src/v1/pushMessages/push-messages.service.ts`, `OLD_BACKEND/src/mail/mail.service.ts`, `OLD_BACKEND/src/services/aws-s3.service.ts`, `OLD_BACKEND/src/services/payments/payments.service.ts`.
- Symbols/responsibilities: list every Socket.IO event name (client-emitted and server-emitted) and the auth handshake source from `notifications.gateway.ts`; list the 4 `@Cron` schedules with their `CronExpression` values and target TASK owners (`TASK-013` for ranking, `TASK-014` for `clearOldLogs`); list push flow entry points and TASK-016 ownership; list mail trigger call sites (method names in `mail.service.ts` and their callers) mapped to owning feature tasks; list S3 upload call sites (`aws-s3.service.ts` methods and each caller controller/service) mapped to `TASK-006` plus the owning feature task per call site; record Fondy (`payments.service.ts`) as D5 as-is, confirm it is commented out of module registration, no HTTP routes, owner `TASK-018`.
- Maps to: FR-02, FR-03, spec "Events, queues and background processing".
- Verification: static cross-check each listed event/cron/call site against its source file; confirm the Fondy commented-out registration claim by inspecting the module file that would otherwise register `PaymentsService`/its controller.

### Phase 4 — Document entities for ETL (data model impact)

- Paths: `docs/migration/ENTITIES_ETL.md` (new); sources: all 11 files under `OLD_BACKEND/src/entities/`.
- Symbols/responsibilities: one row per entity (table name, primary key, notable columns, relations, JSONB columns and their shape) to feed `TASK-020`.
- Maps to: spec "Data model and migration impact".
- Verification: confirm exactly 11 entities are listed and each corresponds to an existing file under `OLD_BACKEND/src/entities/`.

### Phase 5 — Document D6 breaks (AC-03/FR-05)

- Paths: `docs/migration/D6_BREAKS.md` (new).
- Symbols/responsibilities: explicit entries for (a) password hash leaks / missing response sanitization, (b) comment author spoofing via request body `from` field, (c) Error-as-200 responses in campaigns create, comments, appointments, aggregate-search, and admin logs routes; each entry states legacy (broken) behavior, corrected target behavior, and that it is excluded from "same as OLD" parity per `MIGRATION_PROGRAM.md` D6; cross-reference the corresponding rows in `HTTP_PARITY_MATRIX.md` by route path.
- Maps to: AC-03, FR-05.
- Verification: confirm each of the three break categories has at least one entry and that referenced route paths exist as rows in `HTTP_PARITY_MATRIX.md`.

### Phase 6 — Sync status and cross-links (AC-04/AC-05)

- Paths: `docs/agent-tasks/INDEX.md`, `docs/agent-tasks/MIGRATION_PROGRAM.md`.
- Symbols/responsibilities: change the TASK-002 row Status cell in `INDEX.md` from `proposed` to `approved`; in `MIGRATION_PROGRAM.md`, correct the stale "All migration task specifications are currently `proposed`" sentence and add a link from the "Source of truth" section to `docs/migration/README.md`.
- Maps to: AC-04, AC-05.
- Verification: diff review confirming only the TASK-002 row changed in `INDEX.md` (no other row touched) and only the two described edits landed in `MIGRATION_PROGRAM.md`.

## Dependency and compatibility impact

- No package, contract, or runtime dependency changes.
- No backward-compatibility impact; this task only adds documentation and corrects two stale status statements.
- Downstream: `TASK-003…021` implementers and verifiers will use `docs/migration/HTTP_PARITY_MATRIX.md` as the "same as OLD" source of truth going forward, per the spec's "Compatibility requirements".

## Targeted verification

- Manual/static review of each new file against the corresponding `OLD_BACKEND` source files listed in Phases 1–5 (no build/lint/test command applies to markdown-only changes).
- Row-count cross-check: sum of per-controller route counts in `HTTP_PARITY_MATRIX.md` equals 67.
- Link check: every relative link in `docs/migration/README.md` and the `MIGRATION_PROGRAM.md` edit resolves to an existing file path.

## Full verification

- No build, lint, or test command is applicable — this is a documentation-only task per `NFR-02` and the spec's "Verification strategy" ("No runtime commands required beyond doc review").
- If reviewers want an extra sanity check, `git status`/`git diff` may be inspected to confirm only the files listed in "Files to create"/"Files to modify" changed, with no production code touched.

## Acceptance criteria mapping

| Acceptance criterion | Implementation phase | Verification |
| --- | --- | --- |
| AC-01 — Markdown parity matrix lists all OLD controller routes | Phase 2 | Row-count cross-check (67 total, per-controller counts 8/4/1/8/10/2/9/9/2/11/1/2) against `OLD_BACKEND/src/v1/*` decorators |
| AC-02 — Every route row references a TASK owner ID | Phase 2 | Manual per-row check that the `TASK owner` column is populated using the mapping table in Phase 2 |
| AC-03 — D6 break list is explicit | Phase 5 | Confirm `D6_BREAKS.md` contains the password/spoofing/Error-as-200 entries with legacy vs. target behavior and cross-references into `HTTP_PARITY_MATRIX.md` |
| AC-04 — `MIGRATION_PROGRAM.md` links to the matrix | Phase 1, Phase 6 | Confirm `docs/migration/README.md` exists and points to `HTTP_PARITY_MATRIX.md` as SoT, and `MIGRATION_PROGRAM.md` "Source of truth" section links to `docs/migration/README.md` |
| AC-05 — INDEX reflects human approval | Phase 6 | Confirm `docs/agent-tasks/INDEX.md` TASK-002 row Status is `approved` (superseding the spec's original "proposed until approval" wording, since approval has occurred) |

## Rollout strategy

- No rollout; documentation lands directly. Later `TASK-xxx` implementers/verifiers reference `docs/migration/HTTP_PARITY_MATRIX.md` starting immediately after merge.

## Rollback strategy

- Revert the specific commit(s) touching `docs/migration/*`, `docs/agent-tasks/INDEX.md`, and `docs/agent-tasks/MIGRATION_PROGRAM.md`. No runtime or schema state to roll back.

## Risks

- Transcription errors (wrong method/path/auth) in the 67-row matrix could mislead later implementers; mitigated by the per-row spot-check in Phase 2 verification, but a full line-by-line audit of all 67 rows is not performed by this plan's verification step alone — implementers of each `TASK-xxx` should re-confirm their owned rows against `OLD_BACKEND` before building.
- Mail trigger call sites and S3 call sites are enumerated from `mail.service.ts`/`aws-s3.service.ts` method definitions; exhaustively finding every caller across 12 controllers requires careful search during Phase 3 and could miss an indirect call site (e.g. through a shared service). Residual risk documented here rather than silently ignored.
- Because specification open question item on cookie names is intentionally left unresolved for TASK-003, any reader of `HTTP_PARITY_MATRIX.md` must not mistake the "legacy observed" cookie names as the frozen target contract; the matrix explicitly labels them as deferred to avoid this.
- Pre-existing staged bulk approval of all INDEX rows (TASK-002…021) conflicts with decision 5A; human must resolve that staging before Phase 6, or the implementer will incorrectly expand scope.

## Open questions requiring human decision

All in-scope decisions for TASK-002 were resolved by the human on 2026-07-19 before this plan was written:

1. **Catalog location** — Resolved: **B** — living catalog under `docs/migration/` (not `docs/agent-tasks/`).
2. **Catalog structure** — Resolved: **B** — multi-file: `README.md`, `HTTP_PARITY_MATRIX.md`, `SIDE_EFFECTS.md`, `ENTITIES_ETL.md`, `D6_BREAKS.md`, as detailed in "Files to create".
3. **Cookies (FR-06)** — Resolved: **A** — matrix records legacy-observed cookie names (`auth-cookie`, `refresh-cookie`) and Authorization Bearer header rules; target cookie names are explicitly marked deferred to `TASK-003`; this task does not freeze target names.
4. **Row depth** — Resolved: **C** — compact rows for most routes (method, path, auth, key request fields, success shape summary, known error behavior, TASK owner, D6 flag); full example JSON reserved for `/v1/auth/*`, `/v1/profile`, and other auth-sensitive identity responses as needed.
5. **Status sync** — Resolved: **A** — set `INDEX.md` TASK-002 row to `approved`; fix the stale "all specs proposed" sentence in `MIGRATION_PROGRAM.md`; add a link from `MIGRATION_PROGRAM.md` to `docs/migration/README.md`; do **not** bulk-update `INDEX.md` for `TASK-003…021` in this task.

Specification open question status:

- The specification's own open question ("Confirm cookie names for JWT transport when approving TASK-003") is **not resolved by this task** and is intentionally left open for `TASK-003`. Decision 3A above only determines how TASK-002 documents the legacy-observed transport; `docs/agent-tasks/TASK-003-auth-v1-parity.md` is not edited by this plan or its implementation.

No remaining in-scope blockers for TASK-002 planning.
