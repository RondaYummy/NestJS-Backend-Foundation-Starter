# TASK-002 — Implementation report

## Verdict

implemented

(One approved-plan item was intentionally **not** executed by the implementer and is reported as a handled deviation, exactly as the plan itself prescribed: the `INDEX.md` TASK-002 row edit — see "Deviations".)

## Approved specification

`docs/agent-tasks/TASK-002-migration-parity-matrix.md` — frontmatter `status: approved` (verified before implementation).

## Approved plan

`docs/agent-plans/TASK-002-migration-parity-matrix.md` — frontmatter `status: approved` (verified before implementation).

## Changed files

Created:

- `docs/migration/README.md`
- `docs/migration/HTTP_PARITY_MATRIX.md`
- `docs/migration/SIDE_EFFECTS.md`
- `docs/migration/ENTITIES_ETL.md`
- `docs/migration/D6_BREAKS.md`
- `docs/agent-reports/TASK-002-implementation.md` (this report)

Modified:

- `docs/agent-tasks/MIGRATION_PROGRAM.md` (2 lines: parity-catalog link in "Source of truth"; corrected stale "all specs proposed" sentence)

Intentionally NOT modified:

- `docs/agent-tasks/INDEX.md` — see "Deviations".
- No production code, no `package.json`/`package-lock.json`, no other file.

## Completed phases

| Phase | Result |
| --- | --- |
| 1 — Scaffold `docs/migration/README.md` | Done. Index of 5 files; declares `HTTP_PARITY_MATRIX.md` as HTTP contract SoT; D1–D6 by reference only (no duplication); target cookie names marked deferred to TASK-003. |
| 2 — HTTP parity matrix | Done. 12 controller sections, 67 route rows, compact columns per decision 4C; "Auth transport (legacy observed)" section (FR-06/decision 3A); full JSON examples for `/v1/auth/login` and `/v1/profile`; ownership notes for ambiguous rows. |
| 3 — Side effects | Done. Socket.IO events (6 client→server, 5 server→client) + handshake auth order; 4 cron schedules with `CronExpression` values and owners (TASK-013 ×3, TASK-014 ×1); Web Push flow (TASK-016); 3 mail triggers with callers; S3 call sites (TASK-006 + feature owners); Fondy commented-out registration confirmed at `app.module.ts` lines 22/126 (TASK-018, D5 as-is, no HTTP routes). |
| 4 — Entities for ETL | Done. All 11 entities, one row each: table name, PK, notable columns/relations, JSONB/array notes; cross-cutting ETL notes (hyphenated table names, M2M join tables, ineffective TTL index on `tokens`, mixed PK types). |
| 5 — D6 breaks | Done. Three break categories (D6-01 password/sanitization, D6-02 comment author spoofing, D6-03 Error-as-200/swallowed errors), each with legacy behavior, target behavior, owning TASK IDs and matrix row cross-references; explicit not-a-parity-contract statement. |
| 6 — Status sync and cross-links | Partially executed by design: both `MIGRATION_PROGRAM.md` edits landed (AC-04); the `INDEX.md` single-row edit was superseded by the pre-existing staged human change — see "Deviations" (AC-05). |

## Acceptance criteria self-check

| AC | Status | Evidence |
| --- | --- | --- |
| AC-01 — matrix lists all OLD controller routes | Met | 67 route rows counted (`rg -c` = 67); per-controller decorator counts in `OLD_BACKEND/src/v1/*` match section counts exactly (8/4/1/8/10/2/9/9/2/11/1/2) |
| AC-02 — every row references a TASK owner | Met | `rg` filter for route rows lacking `TASK-0` returned zero rows |
| AC-03 — D6 break list explicit | Met | `D6_BREAKS.md` has all three required categories with legacy vs target behavior; all 16 route paths referenced there resolve to matrix rows (scripted cross-check, all `OK`) |
| AC-04 — `MIGRATION_PROGRAM.md` links to the matrix | Met | "Source of truth" now links `../migration/README.md` and names `HTTP_PARITY_MATRIX.md` as SoT; `README.md` links all four sub-files |
| AC-05 — INDEX reflects human approval | Met in working tree, via pre-existing human change | `INDEX.md` TASK-002 row Status is `approved`; the edit is contained in a **pre-existing staged human change** which also bulk-approves TASK-003…021 — see "Deviations" |

## Contract and DI changes

None (documentation-only task, NFR-02 honored — no production code touched).

## Database and migration changes

None. `ENTITIES_ETL.md` only documents the legacy schema for TASK-020.

## Commands executed

1. `git status && git diff --stat` — baseline inspection.
2. `git diff --cached docs/agent-tasks/INDEX.md; git diff docs/agent-tasks/INDEX.md` — confirmed the pre-existing staged bulk-approval change flagged by the plan.
3. Read all 12 `OLD_BACKEND/src/v1/*` controllers, `notifications.gateway.ts`, `notifications.service.ts`, `ranking-system.service.ts`, `admins.service.ts`, `webpush.ts`, `push-messages.service.ts`, `mail.service.ts`, `aws-s3.service.ts`, `payments.service.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `auth.decorator.ts`, `jwt.strategy.ts` (via grep), all 11 entity files, relevant DTO files, and the TASK-005/007/009/014/017/019 specs for ownership resolution.
4. `rg -c '^\| (GET|POST|PUT|PATCH|DELETE) \|' docs/migration/HTTP_PARITY_MATRIX.md` — row count.
5. `rg '^\| (GET|POST|...) \|' ... | rg -cv 'TASK-0'` — owner-cell completeness.
6. `rg -c "@(Get|Post|Put|Patch|Delete)\(" <12 controllers>` — decorator counts per controller.
7. Scripted cross-check of every `/v1/...` path in `D6_BREAKS.md` against `HTTP_PARITY_MATRIX.md`.
8. `git status --short`, `git diff docs/agent-tasks/MIGRATION_PROGRAM.md`, `git diff --stat`, `git diff --name-only` (final diff inspection).
9. Workspace lint diagnostics on all created/modified files.

## Command results

| Command | Result | Conclusion |
| --- | --- | --- |
| Matrix route-row count | `67` | AC-01 total matches inventory |
| Rows without TASK owner | `0` (rg exit 1 = no matches) | AC-02 satisfied |
| Decorator counts per controller | admin 10, campaigns 8, services 1, comments 4, users 9, workers 2, auth 8, schedule 2, vip 1, v1 9, appointments 2, adm-campaigns 11 | Matches matrix sections exactly; sum = 67 |
| D6 path cross-check | 16/16 `OK`, 0 `MISSING` | AC-03 cross-references valid |
| Final `git diff --stat` (unstaged) | `docs/agent-tasks/MIGRATION_PROGRAM.md | 4 ++--` (2 ins, 2 del) | Only the two planned edits landed |
| Final `git status --short` | `M  docs/agent-tasks/INDEX.md` (pre-existing staged, untouched), ` M docs/agent-tasks/MIGRATION_PROGRAM.md`, `?? docs/agent-plans/TASK-002-...md` (pre-existing untracked plan), `?? docs/migration/` | Diff matches "Changed files" list; no production code changed |
| Lint diagnostics | No linter errors | Clean |

No build/lint/test npm command was run: per the approved plan's "Full verification" section, no such command applies to this markdown-only change (spec: "No runtime commands required beyond doc review").

## Deviations

1. **`INDEX.md` Phase-6 edit not performed by the implementer (plan-prescribed handling, requires human resolution at commit time).** The plan (Current implementation bullet 8; Risks bullet 4) records a **pre-existing staged human change** to `docs/agent-tasks/INDEX.md` that bulk-sets Status `approved` for TASK-002…021, conflicting with decision 5A (only the TASK-002 row may change in this task). The plan states a human must unstage/adjust that change before Phase 6. It is still staged and unresolved. To avoid either destroying a user change or silently expanding scope, I left `INDEX.md` untouched. Working-tree state already shows TASK-002 = `approved` (AC-05 functionally satisfied), but the human must decide before committing whether to keep the bulk approval or reduce the staged hunk to the TASK-002 row only.

No other deviation: all other files, sections and decisions follow the approved plan (locations 1B, structure 2B, cookies 3A legacy-observed-only, row depth 4C, status sync 5A minus the INDEX conflict above).

## Documentation changes

All changes in this task are documentation: the five-file `docs/migration/` catalog, two corrected lines in `MIGRATION_PROGRAM.md`, and this report.

## Remaining risks

- Transcription risk on 67 rows: per-controller counts, owner cells and D6 cross-references were verified mechanically; auth modes and error behaviors were transcribed from direct source reads, but a full line-by-line audit of every column of every row was not separately re-performed by an independent party. Later `TASK-xxx` implementers must re-confirm their owned rows against `OLD_BACKEND` (stated in both `README.md` and the matrix).
- Mail/S3/notification call-site enumeration was done via targeted searches (`MailService`, `S3Service`, `emitNewNotification`, `webpush`); an indirect call site through an unsearched shared service could be missed. `SIDE_EFFECTS.md` flags appointment-service internals for TASK-011/TASK-015 re-check.
- Ownership judgments documented in the matrix "Ownership notes" (cities→TASK-005, push routes→TASK-016, admin feedback HTTP→TASK-014, worker attach/detach→TASK-008, services/profitable→TASK-007) resolve conflicts between the plan's shorthand mapping and the task specs in favor of the specs; a reviewer disagreeing with any of these should adjust the matrix row owner before approving downstream tasks.

## Unverified areas

- No runtime execution against `OLD_BACKEND` was performed (not required by spec/plan); all behavior is transcribed from static source reading.
- The `INDEX.md` staged-change resolution (Deviations item 1) is pending human action.
- Legacy database physical schema (M2M join-table names, actual column types in the live DB) was not inspected — `ENTITIES_ETL.md` instructs TASK-020 to verify against `information_schema`.
