# P1-05 — Implementation report

## Verdict

implemented

## Approved plan

- Plan: `docs/agent-plans/P1-05-unwrap-drizzle-unique-violation.md` (frontmatter `status: approved`, `issue_id: P1-05`)
- Source issue: `docs/agent-backlog/INDEX.md` → **P1-05** (High / Confirmed defect), definition in `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-05
- Branch state before implementation: staged/modified backlog + plan docs only; production `UserDrizzleRepository` still used top-level-only unique-violation helpers
- Backlog issue status and plan status were **not** modified
- Open-question recommendations followed: extracted shared `pg-error.util.ts`; unit tests required (manual HTTP optional / not run)

## Changed files

### Created

| Path                                                             | Purpose                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `libs/infrastructure/src/database/drizzle/pg-error.util.ts`      | Bounded `cause`-chain helpers `isUniqueViolation` / `getViolatedConstraint` |
| `libs/infrastructure/src/database/drizzle/pg-error.util.spec.ts` | Unit coverage for direct, wrapped, nested, non-unique, and cyclic shapes    |
| `docs/agent-reports/P1-05-implementation.md`                     | This implementation report                                                  |

### Modified

| Path                                                              | Change                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/repositories/user-drizzle.repository.ts` | Removed local helpers; import shared util; insert/update `DuplicateRecordError` mapping unchanged |

No contracts, DI, OpenAPI, use-case, exception-filter, or `package-lock.json` changes.

Unrelated working-tree noise left untouched: staged backlog/plan docs; pre-existing `docs/agent-tasks/INDEX.md` modification (not part of this fix).

## Completed steps

1. **Revalidated baseline** — Confirmed local helpers only read top-level `code` / `constraint`; issue P1-05 still present; no conflicting production edits.
2. **Added `pg-error.util.ts`** — Walks up to depth 8 over `error` → `cause` with `WeakSet` cycle guard; detects Postgres `23505`; prefers constraint on the same unique-violation frame, else first string constraint after that frame.
3. **Switched `UserDrizzleRepository`** — insert still defaults missing constraint to `'users_email_unique'`; update still throws `DuplicateRecordError(undefined)` when constraint absent.
4. **Unit tests** — Direct `23505`, Drizzle-style wrapper with `cause`, nested chain, non-unique / missing code, circular cause, constraint-on-cause, preference for same-frame constraint.
5. **Verification** — Targeted util specs, full `build` / `lint` / `test:unit`.

## Deviations

None material.

- Plan’s bare `node …/jest.js …/pg-error.util.spec.ts` fails under the default Jest config (no `ts-jest`); ran with `--config jest.unit.config.ts` (same as `npm run test:unit`).
- Optional repository-level mock test not added (plan prefers util tests as primary gate).
- Optional manual duplicate-register HTTP check not run (infra not required per plan recommendation).

## Commands executed

| Command                                                                                                                          | Purpose                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `git status` / `git diff` (before / during / after)                                                                              | Confirm scope and no conflicting production edits |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/database/drizzle/pg-error.util.spec.ts` | Targeted util unit tests                          |
| `npm run build`                                                                                                                  | Full workspace compile                            |
| `npm run lint`                                                                                                                   | ESLint gate                                       |
| `npm run test:unit`                                                                                                              | Full unit gate                                    |

## Command results

| Command               | Result                                                    | Conclusion                             |
| --------------------- | --------------------------------------------------------- | -------------------------------------- |
| Pre-impl `git status` | Plan/backlog docs only in production-adjacent tree        | Safe to implement                      |
| Targeted util specs   | **pass** — 1 suite, 14 tests                              | AC-03 / AC-04 shapes covered           |
| `npm run build`       | **pass** (re-run after lint fix also **pass**)            | Shared infra + all entrypoints compile |
| `npm run lint`        | **pass** after removing unnecessary type assertion        | No lint debt in changed files          |
| `npm run test:unit`   | **pass** — 41 suites, 263 tests                           | Full unit gate green                   |
| Post-impl `git diff`  | Util + util spec + repository import swap (+ this report) | Scope matched plan                     |

## Acceptance criteria self-check

| Criterion                                                           | Status                                    | Evidence                                                                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** Drizzle-wrapped unique violation → `DuplicateRecordError` | **met** (unit-level)                      | Repository still maps `isUniqueViolation` → `DuplicateRecordError`; util detects `{ cause: { code: '23505' } }`                       |
| **AC-02** Duplicate register → 409 / no unexpected-error log        | **met** (path intact; HTTP not re-proven) | Existing use-case/`ConflictError`/`GlobalExceptionFilter` path unchanged; util now feeds that path. Manual HTTP optional and not run. |
| **AC-03** Unit tests for top-level and wrapped shapes               | **met**                                   | `pg-error.util.spec.ts` covers both                                                                                                   |
| **AC-04** Non-unique errors still propagate                         | **met**                                   | Specs assert non-`23505` / missing code are not unique violations; repository still rethrows when helper is false                     |

## Remaining risks

- Cause-chain shape variance beyond known Drizzle + `pg` nesting; mitigated by bounded walk and cycle guard.
- AC-02 end-to-end HTTP 409 not re-verified against a live API + Postgres in this pass.

## Unverified areas

- Live duplicate `POST /auth/register` → HTTP 409 / `USER_ALREADY_EXISTS` (optional manual check).
- Live Google complete-sign-in unique-violation race path (same repository helpers; not separately exercised).
