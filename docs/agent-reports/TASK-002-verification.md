# TASK-002 — Independent verification

## Verdict

approved

## Approved specification

`docs/agent-tasks/TASK-002-migration-parity-matrix.md` — frontmatter `status: approved` (confirmed).

## Approved plan

`docs/agent-plans/TASK-002-migration-parity-matrix.md` — frontmatter `status: approved` (confirmed).

## Scope checked

- Exactly one task ID: **TASK-002**.
- Documentation-only delivery matches `NFR-02` and plan scope: five new files under `docs/migration/`, two planned edits in `MIGRATION_PROGRAM.md`, plus the implementation report and plan artifacts under `docs/`.
- **No production code** under `apps/`, `libs/`, or package manifests appears in the staged diff.
- Plan deviation (INDEX): the implementer did not edit `docs/agent-tasks/INDEX.md`. The staged INDEX hunk bulk-sets Status `approved` for **TASK-002…021**, which exceeds plan decision **5A** (TASK-002 row only). AC-05 still passes because the TASK-002 row is `approved`. The bulk change matches already-approved specification frontmatter for TASK-003…021 and was treated as pre-existing human staging in the implementation report; it is recorded as a non-blocking finding for commit-time human confirmation, not as a failed acceptance criterion.

## Actual changed files

Staged working tree (`git status --short` / `git diff --cached --name-only`):

| Path | Role |
| --- | --- |
| `docs/migration/README.md` | Catalog index (new) |
| `docs/migration/HTTP_PARITY_MATRIX.md` | HTTP parity matrix (new) |
| `docs/migration/SIDE_EFFECTS.md` | Non-HTTP side effects (new) |
| `docs/migration/ENTITIES_ETL.md` | Entity/ETL inventory (new) |
| `docs/migration/D6_BREAKS.md` | D6 break list (new) |
| `docs/agent-tasks/MIGRATION_PROGRAM.md` | Link to catalog + status-tracking sentence fix |
| `docs/agent-tasks/INDEX.md` | Status cells proposed→approved for TASK-002…021 (bulk; see Findings) |
| `docs/agent-plans/TASK-002-migration-parity-matrix.md` | Approved plan artifact |
| `docs/agent-reports/TASK-002-implementation.md` | Implementer report |

Unstaged production diffs: none. No non-`docs/` paths in the staged set.

## Requirements matrix

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-01 — Document every OLD HTTP route | `HTTP_PARITY_MATRIX.md`: 12 controller sections, 67 route rows with method/path/auth/request/success/error columns; decorator counts in `OLD_BACKEND/src/v1/*` match 8/4/1/8/10/2/9/9/2/11/1/2 | passed |
| FR-02 — Socket.IO events and handshake | `SIDE_EFFECTS.md` §1: handshake order (auth.token → Authorization → auth-cookie); 6 `@SubscribeMessage` events; 5 server→client events including `new-notification`; matches `notifications.gateway.ts` | passed |
| FR-03 — Cron, push, mail, S3 | `SIDE_EFFECTS.md` §§2–5: 3 active ranking `@Cron` + `clearOldLogs`; Web Push flow; 3 mail methods/callers; S3 call sites; Fondy D5 as-is with commented `app.module.ts` registration | passed |
| FR-04 — Map rows to TASK-003…021 | Every of 67 route rows has a non-empty `TASK-0xx` owner; ownership notes document ambiguous rows | passed |
| FR-05 — D6 intentional breaks | `D6_BREAKS.md`: D6-01 sanitization, D6-02 comment `from` spoofing, D6-03 Error-as-200; explicit not-a-parity statement | passed |
| FR-06 — Cookie/header under D2 | Matrix “Auth transport (legacy observed)”: `auth-cookie` / `refresh-cookie`, Bearer, deferred target names to TASK-003; corroborated in `jwt.strategy.ts` / `auth.service.ts` | passed |
| NFR-01 — Markdown under `docs/migration/` or `docs/agent-tasks/` | Catalog under `docs/migration/` | passed |
| NFR-02 — No production code | Staged diff is docs-only | passed |

## Acceptance criteria matrix

| AC | Evidence | Result |
| --- | --- | --- |
| AC-01 — Matrix lists all OLD controller routes | 67 matrix route rows; per-controller decorator counts sum to 67 and match inventory | passed |
| AC-02 — Every route row references a TASK owner | 67/67 rows contain `TASK-0`; 0 rows without | passed |
| AC-03 — D6 break list explicit | `D6_BREAKS.md` has all three required categories with legacy vs target behavior; 16 unique `/v1/...` path refs resolve in the matrix | passed |
| AC-04 — `MIGRATION_PROGRAM.md` links to the matrix | “Source of truth” links `docs/migration/README.md` and names `HTTP_PARITY_MATRIX.md` as HTTP SoT; README links all four sibling files | passed |
| AC-05 — INDEX reflects human approval for TASK-002 | INDEX TASK-002 Status = `approved` (plan supersedes original “proposed until approval” wording). Bulk approval of TASK-003…021 is out of plan decision 5A but does not fail this AC | passed |

## Architecture and DI verification

N/A for runtime architecture — documentation-only task. No Domain/Application/Contracts/Infrastructure, provider, or entrypoint changes. Catalog placement and SoT rule match plan Option B/B (`docs/migration/` multi-file).

## Database and migration verification

No schema or migration code changes. `ENTITIES_ETL.md` lists all **11** entity files under `OLD_BACKEND/src/entities/` with table names, PKs, relations, and JSONB/array notes for TASK-020. No ETL scripts executed (out of scope).

## Security verification

- D6 defects correctly marked as intentional breaks, not parity contracts.
- Password-hash leak, comment author spoofing (`CommentItem.from`), and Error-as-200 patterns spot-checked against OLD controllers/services and match the matrix / `D6_BREAKS.md`.
- Target cookie names explicitly deferred (avoids freezing incorrect transport names).
- No secrets introduced in documentation.

## Commands executed

| Command | Result | Conclusion |
| --- | --- | --- |
| `git status --short` / `git diff --cached --stat` / `--name-only` | 9 staged docs paths; `MIGRATION_PROGRAM.md` +4/−2; INDEX bulk status; no non-docs paths | Diff scope is documentation (+ plan/report); INDEX exceeds 5A |
| `git diff --cached docs/agent-tasks/INDEX.md` | All TASK-002…021 Status `proposed`→`approved` | AC-05 satisfied for TASK-002; bulk change is Findings item |
| `git diff --cached docs/agent-tasks/MIGRATION_PROGRAM.md` | Catalog link + status-tracking sentence only | AC-04 and planned Phase 6 program edits present |
| `rg -c '^\| (GET\|POST\|PUT\|PATCH\|DELETE) \|' docs/migration/HTTP_PARITY_MATRIX.md` | `67` | AC-01 total count matches inventory |
| Route rows lacking `TASK-0` | `0` | AC-02 satisfied |
| `rg -c '@(Get\|Post\|Put\|Patch\|Delete)\('` on 12 OLD controllers | 9+8+9+8+11+1+1+2+2+2+4+10 = **67** | Per-controller matrix sections match source |
| D6 path cross-check (16 unique `/v1/...` refs in `D6_BREAKS.md` vs matrix) | 16 OK, 0 MISSING | AC-03 cross-references valid |
| `Test-Path` on `docs/migration/*` and `MIGRATION_PROGRAM` relative link | All `True` | Link targets exist |
| Entity file count vs `ENTITIES_ETL.md` rows | 11 files / 11 table rows | Phase 4 complete |
| `@SubscribeMessage` / `@Cron` / Fondy / mail / cookie spot greps | Events, 3 active ranking crons + `clearOldLogs`, commented PaymentsService, 3 mail methods, `auth-cookie`/`refresh-cookie` match docs | FR-02/FR-03/FR-06 corroborated |
| Spot-read campaigns create `return error`, comments `from`, aggregate-search empty return, profile password strip | Match matrix / D6 narrative | High-risk rows accurate |

No `npm run build` / lint / test: not required by approved plan “Full verification” for markdown-only work.

## Findings

1. **INDEX bulk status (plan decision 5A / medium, non-blocking for ACs).** Staged `INDEX.md` changes Status for TASK-003…021 as well as TASK-002. Plan out-of-scope and decision 5A allow only the TASK-002 row. Implementer correctly left INDEX untouched; human must confirm whether to keep the bulk approval (which aligns INDEX with already-approved spec frontmatter) or reduce the hunk to TASK-002 only before commit.
2. **Full JSON examples depth (low).** Plan Phase 2 / decision 4C reserve full JSON for auth-sensitive routes; delivery includes examples for `POST /v1/auth/login` and `GET /v1/profile` only, not one block per auth route. Compact rows + two high-risk examples remain acceptable under “as needed”; later TASK-003/004 implementers should still re-read OLD responses.
3. **Appointments D6 flag consistency (low).** `D6_BREAKS.md` D6-03 includes `POST /v1/appointments/` as an audit note; the matrix row’s D6 flag is `—`. Path still resolves; not a missing break category.

No high-impact defects in the parity catalog content.

## Documentation alignment

- Spec goal (living catalog + D6 + TASK mapping) met by the five-file `docs/migration/` set.
- `MIGRATION_PROGRAM.md` SoT and status-tracking text align with the catalog and with approved specification frontmatter.
- Implementation report claims for route counts, owners, D6 cross-check, Fondy registration, and NFR-02 were independently re-checked and hold.
- Spec open question (target cookie names for TASK-003) correctly left open.

## Remaining risks

- Transcription risk on non-spot-checked columns of the 67-row matrix (auth nuance, exact error strings) — mitigated by row counts and targeted OLD source checks; downstream TASK owners must re-confirm owned rows.
- Indirect mail/S3/notification call sites may still be incomplete (documented residual risk in plan and `SIDE_EFFECTS.md`).
- Live PostgreSQL join-table names / column types not inspected (`ENTITIES_ETL.md` correctly defers to TASK-020).

## Unverified areas

- No runtime execution of OLD_BACKEND (not required by spec/plan verification strategy).
- Not every matrix cell was line-audited against every DTO field.
- INDEX bulk-approval intent (keep vs reduce to TASK-002) awaits human commit decision.
