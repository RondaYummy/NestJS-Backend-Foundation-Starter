# P1-05 — Independent verification

## Verdict

approved

## Scope checked

- **Issue:** P1-05 — Unwrap Drizzle unique violations so duplicate register returns 409 (High / Confirmed defect).
- **Plan:** `docs/agent-plans/P1-05-unwrap-drizzle-unique-violation.md` — frontmatter `status: approved` (implementation gate satisfied).
- **Production/test changes inspected (staged):**
  - `libs/infrastructure/src/database/drizzle/pg-error.util.ts` (new)
  - `libs/infrastructure/src/database/drizzle/pg-error.util.spec.ts` (new)
  - `libs/infrastructure/src/repositories/user-drizzle.repository.ts` (local helpers removed; shared util imported; insert/update `DuplicateRecordError` mapping preserved)
- **Docs related to this issue:** backlog entry/definition, plan, plans index row, implementation report.
- **Unrelated staged noise (not part of the fix, left as-is):** `docs/agent-tasks/INDEX.md` flips TASK-001/TASK-002 status `proposed` → `approved`. Not production code; does not affect P1-05 behavior.
- **No** contract, DI/composition, OpenAPI, use-case, exception-filter, or `package-lock.json` changes.
- Plan deviations: none material. Targeted Jest invoked with `--config jest.unit.config.ts` (required for TS under this repo’s unit config). Optional repository mock test and live HTTP duplicate-register check not run (both optional per plan).

## Root-cause assessment

**Root cause confirmed and addressed.**

Previous `UserDrizzleRepository` helpers only read top-level `code` / `constraint`. Drizzle wraps the native Postgres `23505` on `error.cause` (`DrizzleQueryError`), so detection missed and the wrapper was rethrown → `RegisterUseCase` never saw `DuplicateRecordError` → filter logged `Unexpected error` and returned HTTP 500.

The new util walks a bounded `cause` chain (depth 8) with a `WeakSet` cycle guard, detects string `code === '23505'`, and extracts string `constraint` preferring the unique-violation frame. Repository `insert` / `update` still throw `DuplicateRecordError`, feeding the existing:

```text
UserDrizzleRepository
  → DuplicateRecordError
    → RegisterUseCase / CompleteGoogleSignInUseCase → ConflictError('USER_ALREADY_EXISTS')
      → GlobalExceptionFilter → HTTP 409 (ConflictError extends AppError → no Unexpected-error log)
```

## Acceptance criteria matrix

| Criterion                                                                                                         | Result     | Evidence                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** Drizzle-wrapped unique violation on users insert/update maps to `DuplicateRecordError`                  | **passed** | Util detects wrapper `{ cause: { code: '23505', … } }`; repository insert/update still map `isUniqueViolation` → `new DuplicateRecordError(...)` and rethrow otherwise.                                                                                                      |
| **AC-02** Duplicate email register → `ConflictError('USER_ALREADY_EXISTS')` → HTTP 409; no `Unexpected error` log | **passed** | Mapping in `register.usecase.ts` / `complete-google-sign-in.usecase.ts` unchanged; `GlobalExceptionFilter` maps `ConflictError` → `HttpStatus.CONFLICT`; `ConflictError` extends `AppError` so Unexpected-error branch is skipped. Live HTTP not re-run (optional per plan). |
| **AC-03** Unit tests cover top-level `23505` and wrapper-with-cause shapes                                        | **passed** | `pg-error.util.spec.ts` — 14 tests including direct and Drizzle-style wrapper cases. Targeted run: 1 suite / 14 passed.                                                                                                                                                      |
| **AC-04** Non-unique DB errors still propagate unchanged                                                          | **passed** | Specs assert non-`23505` / missing code are not unique violations; repository still `throw error` when helper is false.                                                                                                                                                      |

## Dependency and DI verification

- **Contracts:** `DuplicateRecordError` unchanged; no port/token edits.
- **DI / composition roots:** none required; none changed. `UserDrizzleRepository` still `@Injectable()` with `@Inject(DRIZZLE_DB)`.
- **Consumers of helpers:** only `user-drizzle.repository.ts` (grep). No other repositories used the old local helpers.
- **HTTP / OpenAPI:** register still has `@ApiConflictResponse`; no schema edits needed or present.
- **Downstream path:** use cases and filter unchanged; existing Google sign-in unit coverage already asserts `DuplicateRecordError` → `ConflictError('USER_ALREADY_EXISTS')`.

## Commands executed

Command:

```bash
node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/database/drizzle/pg-error.util.spec.ts
```

Result: 1 suite passed, 14 tests passed.
Conclusion: Targeted util coverage for AC-03/AC-04 shapes is green.

Command:

```bash
npm run build
```

Result: exit 0 (`nest build api && nest build worker && nest build cron && nest build migrations`).
Conclusion: Full workspace compile succeeds with the util + repository change.

Command:

```bash
npm run lint
```

Result: exit 0 (`eslint . --max-warnings=0`).
Conclusion: No lint failures in the changed (or other) files.

Command:

```bash
npm run test:unit
```

Result: 41 suites passed, 263 tests passed (exit 0). Pre-existing Nest ERROR log noise from mocked rate-limiter/health in unrelated specs; not a failure.
Conclusion: Full unit gate green; no regression attributable to P1-05.

## Findings

1. **Fix matches approved plan** — shared util with bounded cause walk + cycle guard; repository import swap only; insert default `'users_email_unique'` and update `DuplicateRecordError(undefined)` behavior preserved.
2. **No production-scope creep** — contracts, DI, OpenAPI, use cases, filter untouched.
3. **Minor documentation drift (non-blocking):**
   - `docs/agent-plans/INDEX.md` lists P1-05 status as `proposed` while the plan file frontmatter is `approved`.
   - Staged `docs/agent-tasks/INDEX.md` contains unrelated TASK-001/TASK-002 status edits (pre-existing working-tree noise relative to this bugfix).
4. Live duplicate-register HTTP 409 was not re-proven in this verification pass (optional per plan).

## Documentation alignment

- Backlog issue P1-05 and required-change / AC text align with the implemented util + repository mapping.
- Plan frontmatter `status: approved` — valid gate for implementation.
- OpenAPI conflict documentation on register remains consistent with intended runtime behavior.
- Plans index row status should be updated to `approved` for consistency (cosmetic; does not affect runtime).

## Remaining risks

- Cause-chain shape variance beyond the known Drizzle + `pg` nesting (mitigated by depth bound, cycle guard, and unit shapes).
- AC-02 end-to-end against live API + Postgres not re-verified here; residual operational risk only if an unforeseen wrapper shape differs from tested models.

## Unverified areas

- Live `POST /auth/register` twice → HTTP 409 / `error.code = USER_ALREADY_EXISTS` and absence of `Unexpected error` in API logs.
- Live Google complete-sign-in unique-violation race path (same repository helpers; not separately exercised).
- `npm run test:module` / `test:int` / entrypoint bootstrap (not required by plan for this util-only mapping fix).
