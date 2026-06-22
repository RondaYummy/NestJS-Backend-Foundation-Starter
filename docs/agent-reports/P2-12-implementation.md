# P2-12 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-12-register-flow-docs-alignment.md` — `status: approved`

**Path:** A (docs-only, `register → login`) — default per plan recommendation; no Path B selection recorded in approval comment.

## Changed files

| Path                           | Change                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                    | §16.1 Token family: removed «login або register» claim; added explicit note that register does not create token family; diagram annotated. §7: added step 13 (`POST /auth/login` after registration). |
| `EXAMPLES.md`                  | §4 rewritten to match actual `RegisterUseCase` (user insert + outbox, user-only return). Added §4.1 «Register then login» with curl examples for register, JWT login, and session driver note.        |
| `MODULES_OVERVIEW_NON_TECH.md` | §26: clarified registration creates account only; authentication is a separate login step.                                                                                                            |

## Completed steps

1. Fixed `README.md` §16.1 Token family wording and diagram note.
2. Extended `README.md` §7 Auth registration flow with step 13 (client obtains auth via `POST /auth/login`).
3. Rewrote `EXAMPLES.md` §4 to remove fictional `createAuthSession` after register; added §4.1 with register/login curl examples.
4. Updated `MODULES_OVERVIEW_NON_TECH.md` §26 with registration vs login separation.
5. Cross-checked consistency via grep (see Commands executed).

## Deviations

None. Implemented Path A exactly as specified in the approved plan.

## Commands executed

```bash
git status && git diff
rg -n "login або register|login or register" README.md EXAMPLES.md MODULES_OVERVIEW_NON_TECH.md
rg "AuthTokenService|createAuthSession" libs/application/src/use-cases/auth/register.usecase.ts
rg -n "register|attachIfNeeded" apps/api/src/controllers/auth.controller.ts
npm run build:api
```

## Command results

| Command                                                       | Result                                                                     | Conclusion                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `git status`                                                  | 3 modified doc files only                                                  | Scope matches Path A                                  |
| Doc grep `login або register\|login or register`              | Zero matches in `README.md`, `EXAMPLES.md`, `MODULES_OVERVIEW_NON_TECH.md` | Residual combined claims removed from target docs     |
| `rg AuthTokenService\|createAuthSession` on register use case | No matches                                                                 | Code unchanged; register still has no auth dependency |
| `rg register\|attachIfNeeded` on auth controller              | `attachIfNeeded` only on login path (line 50), not on register             | Controller unchanged                                  |
| `npm run build:api`                                           | Exit code 0                                                                | No compile impact (docs-only)                         |

Manual curl against running API was **not** executed — no API bootstrap in this session. Runtime contract unchanged; existing code already returns user-only register response.

## Acceptance criteria self-check

| Criterion                                                                    | Status        | Evidence                                                                                             |
| ---------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Documentation and runtime response for `POST /auth/register` agree           | Pass (static) | Docs now describe user-only response; code unchanged (`RegisterUseCase` returns `{ user }` only)     |
| JWT and session drivers share the same documented contract                   | Pass          | §4.1 and §7 step 13 document `register → login` for both drivers                                     |
| Examples do not promise refresh/session family where code does not create it | Pass          | `EXAMPLES.md` §4 no longer calls `createAuthSession`; §16.1 no longer claims register creates family |

## Remaining risks

- Residual «register creates auth» wording may exist outside the three primary docs (e.g. backlog/plan files reference the old mismatch by design).
- Manual HTTP verification deferred to independent verifier (V-18).

## Unverified areas

- Live `curl POST /auth/register` against running API (requires bootstrap + PostgreSQL/Redis).
- Full `npm run build` / `npm run lint` not required for Path A per plan; optional `build:api` passed.
