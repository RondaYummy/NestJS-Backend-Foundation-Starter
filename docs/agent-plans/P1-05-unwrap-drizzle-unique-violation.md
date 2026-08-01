---
issue_id: P1-05
status: approved
owner: human-approval-required
---

# P1-05 — Unwrap Drizzle unique violations so duplicate register returns 409

## Source issue

- Backlog index: `docs/agent-backlog/INDEX.md` — **P1-05** (High / Confirmed defect)
- Full definition: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P1-05
- Runtime evidence: local `docker compose` API log — duplicate register for `user@example.com` surfaced as `Unexpected error` / `Failed query: insert into "users"…` instead of HTTP 409

## Current behavior

1. `RegisterUseCase.execute` inserts via `UserDrizzleRepository.insert` inside a transaction (`libs/application/src/use-cases/auth/register.usecase.ts`).
2. On duplicate email, Postgres raises unique violation `23505` / constraint `users_email_unique`.
3. Drizzle’s `PgPreparedQuery.queryWithCache` catches the native `pg` error and throws `DrizzleQueryError` with message `Failed query: …` and `cause` = original error (`drizzle-orm` `errors.js` / `pg-core/session.js`).
4. `UserDrizzleRepository.insert` / `update` catch the error and call local helpers:

```121:128:libs/infrastructure/src/repositories/user-drizzle.repository.ts
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}
```

5. Those helpers only read top-level `code` / `constraint`. `DrizzleQueryError` has neither, so the catch rethrows the wrapper.
6. `RegisterUseCase` only maps `instanceof DuplicateRecordError` → `ConflictError('USER_ALREADY_EXISTS', …)`; the wrapper bypasses that path.
7. `GlobalExceptionFilter` logs `Unexpected error` and returns HTTP 500 / `INTERNAL_SERVER_ERROR` (client body stays generic; logs include the failed query + params, including password hash).

OpenAPI already documents conflict on register (`@ApiConflictResponse` in `apps/api/src/controllers/auth.controller.ts`). Google complete-sign-in has the same `DuplicateRecordError` → `ConflictError` mapping and is equally broken for wrapped unique violations on insert/update.

**Re-validation (this planning pass):** root cause **still present** — helpers do not walk `cause`; only `user-drizzle.repository.ts` implements this mapping in infrastructure repositories.

## Confirmed root cause

Unique-violation detection does not unwrap Drizzle’s error wrapper (`error.cause`), so `DuplicateRecordError` is never thrown for real insert/update uniqueness failures under the current Drizzle/`pg` stack.

## Dependency/runtime flow

```text
POST /auth/register (or Google complete-sign-in insert/update race)
  → RegisterUseCase / CompleteGoogleSignInUseCase
    → UserDrizzleRepository.insert|update
      → db.insert|update (Drizzle)
        → pg raises DatabaseError code 23505
        → Drizzle throws DrizzleQueryError(query, params, cause=DatabaseError)
      → isUniqueViolation / getViolatedConstraint  (today: miss; target: walk cause)
        → DuplicateRecordError(constraint?)
    → ConflictError('USER_ALREADY_EXISTS')
  → GlobalExceptionFilter → HTTP 409
```

No composition / DI / contract token changes required. `DuplicateRecordError` in `libs/contracts/src/repositories/repository-errors.ts` stays unchanged.

## Goal

Map Drizzle-wrapped (and direct) Postgres unique violations from `UserDrizzleRepository` to `DuplicateRecordError` so existing use-case and filter paths return the documented HTTP 409 conflict instead of an unexpected 500.

## Scope

- Fix unique-violation / constraint extraction to inspect a bounded `cause` chain.
- Keep `UserDrizzleRepository.insert` / `update` throwing `DuplicateRecordError` (existing use-case mapping unchanged).
- Extract helpers to a small testable infrastructure util (preferred) or cover them via repository unit tests with injectable/mocked DB.
- Add unit tests for wrapped and unwrapped shapes; assert non-unique errors still propagate.
- No OpenAPI schema changes (409 already documented).

## Out of scope

- Changing `RegisterUseCase` / `CompleteGoogleSignInUseCase` conflict messages or codes.
- Pre-insert `findByEmail` check as a substitute for race-safe unique handling (insert + map remains the source of truth).
- Redacting Drizzle query params from logs for unrelated errors (only ensure this path no longer hits unexpected-error logging).
- Other repositories that do not currently map unique violations (none today besides users).
- Migrations, Redis, Auth token stores, or P1-01…P1-04 work.

## Files to create

| Path                                                             | Responsibility                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/database/drizzle/pg-error.util.ts`      | Export `isUniqueViolation(error)` and `getViolatedConstraint(error)` that walk a bounded `cause` chain for Postgres `code === '23505'` and string `constraint`.                             |
| `libs/infrastructure/src/database/drizzle/pg-error.util.spec.ts` | Unit tests: direct `23505`; `Error`/`DrizzleQueryError`-like wrapper with `cause`; nested cause; non-unique / missing code; circular cause does not hang; constraint present only on cause. |

## Files to modify

| Path                                                              | Symbol / change                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/repositories/user-drizzle.repository.ts` | Remove local `isUniqueViolation` / `getViolatedConstraint`; import shared util; keep `insert`/`update` `DuplicateRecordError` mapping and default `'users_email_unique'` on insert when constraint missing. |

## Files to delete

None.

## Contract and DI changes

- **Contracts:** none (`DuplicateRecordError` unchanged).
- **DI / composition roots:** none.
- **Public HTTP:** behavior-only fix — documented 409 / `USER_ALREADY_EXISTS` path starts working; no new status codes or envelope fields.
- **OpenAPI:** no decorator/schema edits required (verify register still documents conflict after fix).

## Implementation steps

1. Add `pg-error.util.ts` with:
   - bounded walk (e.g. max depth ~5–8) over `error` then `error.cause`;
   - `isUniqueViolation`: true if any visited object has `code === '23505'` (string compare);
   - `getViolatedConstraint`: first string `constraint` found on a visited unique-violation object (or on the chain when `23505` is found — prefer constraint on the same object that has `code`, else first string `constraint` on that chain frame);
   - guard against cyclic `cause` with a `WeakSet`.
2. Switch `UserDrizzleRepository` to the shared helpers; leave insert/update try/catch structure and thrown types unchanged.
3. Add `pg-error.util.spec.ts` covering AC-01/AC-03/AC-04 shapes without requiring a live Postgres.
4. Optionally add a thin repository-level test only if mocking `DRIZZLE_DB` is already cheap; prefer util tests as the primary gate.
5. Run targeted unit tests, then full verification commands below.
6. Do **not** change use cases or the exception filter unless a follow-up shows `instanceof DuplicateRecordError` fails across package boundaries (not observed; same Error subclass pattern already used in Google sign-in specs).

## Migration and rollout concerns

- No DB migration.
- No env/config change.
- Backward compatible: direct (unwrapped) `23505` errors remain detected.
- Deploy: normal API rollout; clients that incorrectly relied on 500 for duplicate email will start receiving 409 (intended contract).

## Targeted verification

```bash
node node_modules/jest/bin/jest.js libs/infrastructure/src/database/drizzle/pg-error.util.spec.ts
npm run build
npm run lint
```

If a repository spec is added:

```bash
node node_modules/jest/bin/jest.js libs/infrastructure/src/repositories/user-drizzle.repository.spec.ts
```

Optional manual check (when API + Postgres up): register twice with the same email → second response HTTP 409, `error.code` = `USER_ALREADY_EXISTS`, no `Unexpected error` log for that request.

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
```

`npm run test:module` / `test:int` not required for this util-only mapping fix unless implementer touches composition; skip bootstrap unless verifying the optional manual HTTP check.

## Acceptance criteria

- **AC-01:** Drizzle-wrapped Postgres unique violation on users insert/update maps to `DuplicateRecordError`.
- **AC-02:** Duplicate email register yields `ConflictError('USER_ALREADY_EXISTS')` → HTTP 409 via existing filter; that request is not logged as `Unexpected error`.
- **AC-03:** Unit tests cover top-level `23505` and wrapper `{ cause: { code: '23505', constraint } }`.
- **AC-04:** Non-unique DB errors still propagate unchanged.

## Risks

- **Cause-chain shape variance:** some drivers nest deeper or use non-enumerable fields; mitigate with bounded walk and tests for the known Drizzle + `pg` shape.
- **Constraint missing on cause:** insert already defaults to `'users_email_unique'`; update may throw `DuplicateRecordError(undefined)` — preserve current behavior.
- **False positives:** only treat exact Postgres code `23505`; do not match on message text alone.

## Rollback strategy

Revert the util + repository import change; behavior returns to today’s 500 on duplicate register (undesirable but local and safe).

## Open questions requiring human decision

1. **Shared util vs inline fix:** Prefer extracting `pg-error.util.ts` for testability and reuse. Acceptable to keep helpers file-private in the repository **only if** they are still unit-tested by exporting them for tests or testing through a repository mock — **recommendation:** extract util as in this plan.
2. **Manual HTTP evidence:** Is docker-compose register-twice required for verification, or are unit tests + build/lint/`test:unit` sufficient for human acceptance? **Recommendation:** unit tests required; manual HTTP optional when infra is up.
