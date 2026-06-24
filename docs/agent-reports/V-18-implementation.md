# V-18 — Implementation report

## Verdict

implemented

V-18 is a verification scenario (not a code change). P2-12 Path A (docs-only) is present on `main`; independent verification confirms `POST /auth/register` response shape and documented auth/session behavior align for both JWT and session drivers.

## Approved plan

`docs/agent-plans/V-18-register-auth-session-behavior.md` — `status: approved`

**Approved P2-12 path:** A (docs-only, `register → login`)

## Changed files

None. This issue verifies P2-12 outcome; no production or documentation edits were made during V-18 execution.

**P2-12 files verified (already on branch):**

| Path                           | Role in Path A                                      |
| ------------------------------ | --------------------------------------------------- |
| `README.md`                    | §6.3, §7, §16.1 aligned on user-only register       |
| `EXAMPLES.md`                  | §4 user-only return; §4.1 register-then-login curls |
| `MODULES_OVERVIEW_NON_TECH.md` | §26 registration ≠ authentication                   |

**Code files confirmed unchanged:**

| Path                                                      | Status        |
| --------------------------------------------------------- | ------------- |
| `libs/application/src/use-cases/auth/register.usecase.ts` | No auth dependency |
| `apps/api/src/controllers/auth.controller.ts`             | `attachIfNeeded` on login only |
| `apps/api/src/composition/auth-application.module.ts`     | Unchanged     |

## Completed steps

1. Confirmed P2-12 plan `status: approved`, Path A recorded in P2-12 implementation report.
2. Confirmed P2-12 implementation and verification reports exist (`P2-12-implementation.md`, `P2-12-verification.md`).
3. Ran scope/diff review — no conflicting uncommitted production changes (staged deletion of `docs/agent-backlog/INDEX.md` is unrelated to register contract).
4. Static contract trace: register use case has no `AuthTokenService` / `createAuthSession`; controller `attachIfNeeded` only on login.
5. Documentation alignment matrix — all Path A pass conditions met (see Acceptance criteria self-check).
6. Runtime HTTP verification with local PostgreSQL + Redis (see Command results).
7. `npm run build:api` and `npm run lint` executed successfully.

## Deviations

None from the approved V-18 plan.

## Commands executed

```bash
git status && git diff --stat
rg "AuthTokenService|createAuthSession" libs/application/src/use-cases/auth/register.usecase.ts
rg -n "register|attachIfNeeded" apps/api/src/controllers/auth.controller.ts
npm run build:api
npm run lint
npm run db:migrate   # prerequisite for runtime curl (DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app)
npm run start:api    # JWT driver, APP_PORT=3001
npm run start:api    # session driver, APP_PORT=3003
curl POST /auth/register  # JWT and session drivers
curl POST /auth/login     # JWT and session drivers after register
```

## Command results

| Command / scenario | Result | Conclusion |
| ------------------ | ------ | ---------- |
| `git status` | Staged deletion of `docs/agent-backlog/INDEX.md` only; P2-12 doc changes already on `main` | No V-18 code scope |
| `rg AuthTokenService\|createAuthSession` on register use case | No matches | Path A: register does not create auth |
| `rg register\|attachIfNeeded` on auth controller | `attachIfNeeded` at login (line 50) only | Path A: no cookie on register |
| Doc grep (`login або register\|login or register`) in README.md, EXAMPLES.md, MODULES_OVERVIEW_NON_TECH.md | Zero matches (via workspace grep) | Residual combined claims removed |
| `npm run build:api` | Exit 0 | API compiles |
| `npm run lint` | Exit 0 | No lint errors |
| `npm run db:migrate` | Exit 0 | Migrations applied against local Postgres |
| **5a** `curl POST /auth/register` (JWT, port 3001) | HTTP 201; `data.user` present; `data.auth` absent; no `Set-Cookie` | Matches Path A contract |
| **5b** `curl POST /auth/login` after register (JWT) | HTTP 201; `data.auth.accessToken` and `data.auth.refreshToken` present | Auth issued on login, not register |
| **5a/5c** register + login (session, port 3003) | Register: user-only, no cookie; Login: `Set-Cookie: sid=...`; `data.auth.sessionId` in body | Session driver matches documented `register → login` flow |

### Runtime evidence (Path A)

**Issue ID:** V-18  
**Command/scenario:** `curl -s -D - -X POST http://localhost:3001/auth/register` (JWT driver)  
**Expected result:** HTTP 2xx; `success: true`; `data.user` with `id`, `email`, `roles`; no `data.auth`; no session cookie  
**Actual result:** HTTP 201; body `{"success":true,"data":{"user":{"id":"69580348-7e66-4b57-abc2-5cb3cb34a0b6","email":"v18-register-1782269495@example.com","roles":["user"]}}}`; no `Set-Cookie`  
**Exit code:** 0  
**Evidence:** curl output captured in session  
**Verdict:** approved  

**Issue ID:** V-18  
**Command/scenario:** `curl POST /auth/login` after register (JWT, same user)  
**Expected result:** `data.auth.accessToken` and `data.auth.refreshToken` present  
**Actual result:** Both tokens present in response body  
**Exit code:** 0  
**Evidence:** curl output captured in session  
**Verdict:** approved  

**Issue ID:** V-18  
**Command/scenario:** `curl POST /auth/register` then `curl POST /auth/login` (session driver, port 3003)  
**Expected result:** Register: user-only, no cookie; Login: `Set-Cookie: sid=...` and `data.auth.sessionId`  
**Actual result:** Register: user-only, no cookie; Login: `Set-Cookie: sid=b6ff3840-b5ac-4a93-a6b2-109ed7e55006`; `data.auth.sessionId` in body  
**Exit code:** 0  
**Evidence:** curl output captured in session  
**Verdict:** approved  

## Acceptance criteria self-check

| ID   | Criterion | Status | Evidence |
| ---- | --------- | ------ | -------- |
| AC-1 | P2-12 fix implemented for human-approved path | Pass | Path A doc changes on `main`; P2-12 reports approved |
| AC-2 | Documentation and runtime response for `POST /auth/register` agree | Pass | Docs describe user-only; curl confirms no `data.auth` |
| AC-3 | JWT and session drivers share the same documented contract | Pass | EXAMPLES §4.1; runtime register identical; auth on login for both drivers |
| AC-4 | Examples do not promise refresh/session family where code does not create it | Pass | EXAMPLES §4 no `createAuthSession`; §16.1 login-only family |
| AC-5 | `README.md` §6.3, §7, §16.1 internally consistent | Pass | All describe user-only register; §7 step 13 documents login step |
| AC-6 | Path B: auth after DB commit | N/A | Path A selected |
| AC-7 | Path B: build and lint | N/A | Path A selected; build:api and lint still pass |

## Remaining risks

- Residual «login or register» wording may exist in agent backlog/plan files (historical references by design).
- Background API processes started for verification were not left running; no impact on deliverable.

## Unverified areas

None for Path A scope. Runtime curl evidence obtained for both JWT and session drivers when PostgreSQL and Redis were available locally.
