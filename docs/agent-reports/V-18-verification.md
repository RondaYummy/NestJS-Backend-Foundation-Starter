# V-18 — Independent verification

**Verifier:** independent-verifier  
**Date:** 2026-06-24  
**Plan:** `docs/agent-plans/V-18-register-auth-session-behavior.md` — status `approved`  
**Implementation report:** `docs/agent-reports/V-18-implementation.md`  
**Linked defect:** P2-12 — Path A (docs-only, `register → login`)

---

## Verdict

**approved**

All applicable acceptance criteria (AC-1 through AC-5) pass for P2-12 Path A. Runtime HTTP evidence was obtained for both JWT and session drivers when PostgreSQL and Redis were available locally. AC-6 and AC-7 are N/A for Path A.

---

## Approved P2-12 path

**A** (docs-only — register returns user only; auth issued on separate `POST /auth/login`)

---

## Scope checked

V-18 is a verification scenario, not a code change. No production or documentation files were modified during V-18 execution.

### Working tree (independent `git status`)

| Item | Finding |
| ---- | ------- |
| Staged deletion | `docs/agent-backlog/INDEX.md` — unrelated to register contract |
| Untracked reports | `docs/agent-reports/V-18-implementation.md`, `V-19-implementation.md` |
| P2-12 production code | No uncommitted changes to register flow |

### P2-12 files verified (already on branch)

| File | Path A role | Status |
| ---- | ----------- | ------ |
| `README.md` | §6.3, §7, §16.1 aligned on user-only register | **Pass** |
| `EXAMPLES.md` | §4 user-only return; §4.1 register-then-login curls | **Pass** |
| `MODULES_OVERVIEW_NON_TECH.md` | §26 registration ≠ authentication | **Pass** |

### Code files confirmed unchanged

| File | Static trace | Status |
| ---- | ------------ | ------ |
| `libs/application/src/use-cases/auth/register.usecase.ts` | No `AuthTokenService` / `createAuthSession` | **Pass** |
| `apps/api/src/controllers/auth.controller.ts` | `attachIfNeeded` on `login` only (line 50), not on `register` | **Pass** |
| `apps/api/src/composition/auth-application.module.ts` | No register auth DI changes | **Pass** (no diff expected) |

Scope is limited to P2-12 Path A outcome. No unrelated refactor detected.

---

## Root-cause assessment

**Original root cause:** Documentation–implementation drift on the register auth contract (`README.md` §16.1 and `EXAMPLES.md` §4 implied auth/session creation on register; code returned `{ user }` only).

**Fix verified (Path A):** Documentation aligned with existing runtime behavior. Code path unchanged:

```text
POST /auth/register
  → AuthController.register()
  → RegisterUseCase.execute()  (user + outbox only)
  → { success: true, data: { user } }
  (no IAuthTokenService, no SessionCookieService on register)

POST /auth/login
  → LoginUseCase.execute()
  → SessionCookieService.attachIfNeeded()  (session driver)
  → { success: true, data: { user, auth } }
```

The symptom is not suppressed — the mismatch is resolved by aligning documentation to the actual contract, not by altering undocumented behavior.

---

## Acceptance criteria matrix

| ID | Criterion | Status | Evidence |
| -- | --------- | ------ | -------- |
| AC-1 | P2-12 fix implemented for human-approved path | **passed** | P2-12 plan `status: approved`; Path A doc changes present; P2-12 implementation + verification reports approved |
| AC-2 | Documentation and runtime response for `POST /auth/register` agree | **passed** | Docs describe user-only return; HTTP 201 with `data.user` only, no `data.auth` (JWT + session) |
| AC-3 | JWT and session drivers share the same documented contract | **passed** | `EXAMPLES.md` §4.1 states identical register contract; runtime register identical on both drivers; auth on login for each driver |
| AC-4 | Examples do not promise refresh/session family where code does not create it | **passed** | `EXAMPLES.md` §4 has no `createAuthSession`; `README.md` §16.1 login-only family + explicit register exclusion |
| AC-5 | `README.md` §6.3, §7, §16.1 internally consistent | **passed** | §6.3/§7 describe user-only register; §7 step 13 documents `POST /auth/login`; §16.1 states register does not create token family |
| AC-6 | Path B: auth side effect after DB commit | **N/A** | Path A selected |
| AC-7 | Path B: `npm run build:api` and `npm run lint` pass | **N/A** | Path A selected; build and lint still executed and pass |

---

## Documentation alignment

| Location | Path A pass condition | Result |
| -------- | --------------------- | ------ |
| `README.md` §16.1 | Family created on login only; register excluded | **Pass** — «При login створюється…»; explicit note that `POST /auth/register` **не** створює token family |
| `README.md` §7 | Step documents `register → login` | **Pass** — step 13: separate `POST /auth/login` |
| `README.md` §6.3 | User-only register flow | **Pass** — steps 1–8, no auth step |
| `EXAMPLES.md` §4 | User-only return; separate login example | **Pass** — comment + return shape; no `createAuthSession` |
| `EXAMPLES.md` §4.1 | Register-then-login curls for both drivers | **Pass** |
| `MODULES_OVERVIEW_NON_TECH.md` §26 | Register ≠ authenticate | **Pass** — explicit separate login step |

**Doc grep** (`login або register|login or register` in `README.md`, `EXAMPLES.md`, `MODULES_OVERVIEW_NON_TECH.md`): **zero matches** (exit code 1 from `rg`).

---

## Dependency and DI verification

Path A is documentation-only. No DI changes required or present.

```text
AuthController.register()
  → RegisterUseCase (UserRepository, PasswordHasher, TransactionManager, OutboxWriter)
  → no TOKENS.AuthTokenService
  → no SessionCookieService.attachIfNeeded on register path

AuthController.login()
  → LoginUseCase
  → SessionCookieService.attachIfNeeded(res, result.auth)
```

Confirmed via file inspection and grep; no changes in composition module for register auth.

---

## Runtime HTTP evidence

**Infrastructure:** PostgreSQL and Redis available at `localhost`. Session API on port 3003 was already running; JWT API started on port 3001 for verification.

**Note:** `curl.exe` intermittently crashes in this Windows shell (exit `-1073741819`); HTTP scenarios were executed via PowerShell `Invoke-WebRequest` with JSON body files (equivalent to plan curl scenarios).

### Scenario records

**Issue ID:** V-18  
**Command/scenario:** `POST http://localhost:3001/auth/register` (JWT driver)  
**Expected result:** HTTP 2xx; `success: true`; `data.user` with `id`, `email`, `roles`; no `data.auth`; no session cookie  
**Actual result:** HTTP **201**; body `{"success":true,"data":{"user":{"id":"ca1336a9-8846-47c1-898f-6f5c6eda0475","email":"v18-jwt-1782270241648@example.com","roles":["user"]}}}`; no `Set-Cookie`  
**Exit code:** 0  
**Evidence:** Independent shell verification run 2026-06-24  
**Verdict:** approved  

**Issue ID:** V-18  
**Command/scenario:** `POST http://localhost:3001/auth/login` after register (JWT, same user)  
**Expected result:** `data.auth.accessToken` and `data.auth.refreshToken` present  
**Actual result:** HTTP **201**; both tokens present in `data.auth`; no cookies  
**Exit code:** 0  
**Evidence:** Independent shell verification run 2026-06-24  
**Verdict:** approved  

**Issue ID:** V-18  
**Command/scenario:** `POST http://localhost:3003/auth/register` (session driver)  
**Expected result:** User-only body; no cookie  
**Actual result:** HTTP **201**; `data.user` only; no `Set-Cookie`  
**Exit code:** 0  
**Evidence:** Independent shell verification run 2026-06-24  
**Verdict:** approved  

**Issue ID:** V-18  
**Command/scenario:** `POST http://localhost:3003/auth/login` after register (session driver)  
**Expected result:** `Set-Cookie: sid=...`; `data.auth.sessionId` in body  
**Actual result:** HTTP **201**; `Set-Cookie: sid=f229d303-d4e8-44b5-8c10-1332206dca50; HttpOnly; SameSite=Lax`; `data.auth.sessionId` matches cookie  
**Exit code:** 0  
**Evidence:** Independent shell verification run 2026-06-24  
**Verdict:** approved  

---

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `git status --short` | Staged `INDEX.md` deletion; untracked agent reports | No V-18 production scope |
| `rg "AuthTokenService\|createAuthSession" libs/application/src/use-cases/auth/register.usecase.ts` | No matches | Path A: register does not create auth |
| `rg "register\|attachIfNeeded" apps/api/src/controllers/auth.controller.ts` | `attachIfNeeded` at login only | Path A: no cookie on register |
| `rg -n "login або register\|login or register" README.md EXAMPLES.md MODULES_OVERVIEW_NON_TECH.md` | Exit 1 (no matches) | Residual combined claims removed |
| `npm run build:api` | Exit 0 | API compiles |
| `npm run lint` | Exit 0 | No lint errors |
| HTTP scenarios 5a–5c (JWT + session) | All passed (see Runtime HTTP evidence) | Runtime matches Path A contract |

---

## Findings

1. **P2-12 prerequisite satisfied** — Path A documentation alignment is present and matches unchanged register/login code paths.
2. **Implementation report corroborated** — Independent static inspection and HTTP runs confirm the implementer’s claims; no trust-only approval.
3. **Cosmetic doc formatting** — `MODULES_OVERVIEW_NON_TECH.md` §26 list structure (noted in P2-12 verification) does not affect semantic correctness or any V-18 criterion.
4. **Historical wording** — Agent backlog/plan files still reference «login or register» in issue descriptions; target user-facing docs are clean.

---

## Documentation alignment (summary)

User-facing documentation and runtime behavior for `POST /auth/register` are aligned for Path A across both auth drivers. Register creates an account only; JWT tokens or session cookies are obtained via a subsequent `POST /auth/login`, as documented in `README.md`, `EXAMPLES.md`, and `MODULES_OVERVIEW_NON_TECH.md`.

---

## Remaining risks

- Clients or forks that relied on pre-P2-12 misleading docs expecting auto-login on register must adopt the documented `register → login` flow (non-breaking for code; behavioral expectation change for misinformed consumers only).
- Residual historical references in agent workflow docs may confuse future agents unless read in context of closed P2-12.

---

## Unverified areas

None for Path A scope. Runtime HTTP evidence obtained for both JWT and session drivers with local PostgreSQL and Redis available.
