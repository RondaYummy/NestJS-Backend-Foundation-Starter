---
issue_id: V-18
status: approved
owner: human-approval-required
---

# V-18 — Register endpoint response matches documented auth/session behavior

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-18**:

> Register endpoint response matches documented auth/session behavior

**Linked defect:** **P2-12** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-12; implementation plan `docs/agent-plans/P2-12-register-flow-docs-alignment.md`).

**Investigation (2026-06-22, branch `main`):** verification scenario is **not stale**. Documentation and runtime behavior for `POST /auth/register` still disagree. V-18 cannot return `approved` until P2-12 is implemented (human-selected path) and independently verified.

## Current behavior

### HTTP layer — `AuthController`

| Endpoint              | Symbol                      | Behavior                                                                                                                                            |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register` | `AuthController.register()` | Calls `RegisterUseCase.execute(dto)` only. No `@Res`, no `SessionCookieService`. Returns `{ success: true, data: result }`.                         |
| `POST /auth/login`    | `AuthController.login()`    | Calls `LoginUseCase.execute(dto)`, then `SessionCookieService.attachIfNeeded(res, result.auth)`. Returns `{ success: true, data: { user, auth } }`. |

```35:56:apps/api/src/controllers/auth.controller.ts
  async register(@Body() dto: RegisterDto) {
    const result = await this.registerUseCase.execute(dto);

    return {
      success: true,
      data: result,
    };
  }

  // ...

  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.loginUseCase.execute(dto);

    this.sessionCookieService.attachIfNeeded(res, result.auth);

    return {
      success: true,
      data: result,
    };
  }
```

**Actual register response today:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "<uuid>",
      "email": "user@example.com",
      "roles": ["user"]
    }
  }
}
```

No `data.auth`. No `Set-Cookie` for session driver.

### Application layer — `RegisterUseCase`

```16:63:libs/application/src/use-cases/auth/register.usecase.ts
export class RegisterUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly transactionManager: ITransactionManager,
    private readonly outboxWriter: IOutboxWriter,
  ) {}

  async execute(input: RegisterInput) {
    // ... transaction: insert user + UserRegisteredEvent ...
    return {
      user: {
        id: user.id,
        email: user.email.toString(),
        roles: user.roles,
      },
    };
  }
}
```

- Does **not** inject `IAuthTokenService`.
- Does **not** call `createAuthSession()`.
- Does **not** return an `auth` object.

### Documentation (mismatch sources)

| Location                       | Symbol / section                             | Claim                                                                                              |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `README.md`                    | §16.1 Token family (line ~2204)              | «При login **або register** створюється окрема refresh-token family.»                              |
| `EXAMPLES.md`                  | §4 «Транзакція в use case» (lines ~176–206)  | After commit, calls `authTokenService.createAuthSession(...)` and returns `{ user, auth }`.        |
| `README.md`                    | §6.3 RegisterUseCase flow (lines ~1597–1608) | Accurate: user-only return, no auth step.                                                          |
| `README.md`                    | §7 Auth registration flow (lines ~1658–1677) | Accurate: no auth/session step; ends at welcome email.                                             |
| `MODULES_OVERVIEW_NON_TECH.md` | §26 Auth capabilities (lines ~460–483)       | Lists registration and login separately; does not explicitly state register does not authenticate. |

### Tests

- No unit tests for `RegisterUseCase` or `LoginUseCase`.
- No API/integration tests for `POST /auth/register`.
- No automated contract test tying docs to HTTP response shape.

## Confirmed root cause

**Documentation–implementation drift on the register auth contract** (same as P2-12).

1. **Code path:** `RegisterUseCase` and `AuthController.register()` stop after user persistence + outbox; they never invoke `IAuthTokenService.createAuthSession()` or `SessionCookieService.attachIfNeeded()`.
2. **Docs path:** At least `README.md` §16.1 and `EXAMPLES.md` §4 describe or exemplify post-register auth/session creation.
3. **Internal split:** `README.md` §6.3/§7 already describe user-only register; §16.1 and `EXAMPLES.md` §4 contradict them.

## Dependency/runtime flow

### Current register flow (baseline — V-18 fails today)

```text
POST /auth/register
  → AuthController.register(RegisterDto)
  → RegisterUseCase.execute()
      → IPasswordHasher.hash()
      → ITransactionManager.run()
          → User.create() [authVersion=0]
          → IUserRepository.insert(user, trx)
          → IOutboxWriter.append(UserRegisteredEvent, trx)
      → return { user }
  → { success: true, data: { user } }
  (no Redis auth state, no cookie)
```

### Expected after P2-12 Path A (docs-only — recommended in P2-12 plan)

```text
POST /auth/register  →  { success: true, data: { user } }   (unchanged)
POST /auth/login     →  { success: true, data: { user, auth } } + cookie (session driver)

Docs/README/EXAMPLES explicitly document register → login for both JWT and session drivers.
No doc claims register creates refresh/session family.
```

### Expected after P2-12 Path B (code auto-login)

```text
POST /auth/register
  → RegisterUseCase.execute()
      → transaction commit (user + outbox)
      → IAuthTokenService.createAuthSession()  [after commit]
      → return { user, auth }
  → SessionCookieService.attachIfNeeded(res, auth)  [session driver]
  → { success: true, data: { user, auth } }

Docs aligned with login-equivalent auth issuance on register.
```

### Prerequisite bootstrap chain (runtime verification)

```text
ApiModule
  → AuthApplicationCompositionModule.register(...)
       → AuthModule / JwtModule DI  (see V-16 / P1-06)
       → RegisterUseCase / LoginUseCase factories
POST /auth/register requires:
  → PostgreSQL (user insert + outbox)
  → Redis (rate limiter; auth state only if Path B or follow-up login)
```

## Goal

Independently confirm — with runtime HTTP evidence and documentation cross-check, not static inspection alone — that `POST /auth/register` response shape and documented auth/session behavior match for both JWT and session drivers after P2-12 is implemented.

## Scope

| Activity                 | Responsibility        | Notes                                                                                        |
| ------------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| Align docs and/or code   | **P2-12 implementer** | Path A (docs-only) or Path B (auto-login) per human approval                                 |
| Independent verification | **V-18 verifier**     | Inspect diff, run doc grep + HTTP scenarios, write `docs/agent-reports/V-18-verification.md` |

## Out of scope

- Implementing the P2-12 fix (separate approved plan).
- Email verification / confirm-before-login flows.
- OpenAPI/Swagger generation (none on auth controller today).
- Login, refresh, logout, or auth infrastructure changes beyond P2-12 scope.
- **V-16** API Auth DI bootstrap — separate verification; runtime curl may be blocked until P1-06/V-16 pass, but static doc/code alignment checks can proceed independently.
- Marking P2-12 or V-18 resolved in backlog INDEX without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-18-verification.md` | Independent verification report (verifier output; not created during planning) |

**Prerequisites from P2-12 (implementer may create depending on approved path):**

| File                                                           | Path        | When                                                    |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| `libs/application/src/use-cases/auth/register.usecase.spec.ts` | Path B only | Unit test: `createAuthSession` after transaction commit |

## Files to modify

None during verification planning. Verifier inspects changes from P2-12:

### Path A (docs-only — expected files)

| File                           | What to verify                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `README.md`                    | §16.1: no «login або register» family claim; §7: explicit `register → login` step                      |
| `EXAMPLES.md`                  | §4: register example matches user-only return; §4.1 (or equivalent): register then login curl examples |
| `MODULES_OVERVIEW_NON_TECH.md` | §26: registration and login are separate steps                                                         |

### Path B (code auto-login — expected files)

| File                                                       | What to verify                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `libs/application/src/use-cases/auth/register.usecase.ts`  | `IAuthTokenService` injected; `createAuthSession` after `transactionManager.run()` |
| `apps/api/src/composition/auth-application.module.ts`      | `RegisterUseCase` factory includes `TOKENS.AuthTokenService`                       |
| `apps/api/src/controllers/auth.controller.ts`              | `register()` calls `sessionCookieService.attachIfNeeded(res, result.auth)`         |
| `README.md`, `EXAMPLES.md`, `MODULES_OVERVIEW_NON_TECH.md` | All register sections describe `{ user, auth }` for both drivers                   |

## Files to delete

None.

## Contract and DI changes

- **Verifier expectation (Path A):** no HTTP API or DI changes; docs must match existing user-only register contract.
- **Verifier expectation (Path B):** register response gains `auth` object (same shape as login); `RegisterUseCase` factory gains `TOKENS.AuthTokenService`; session driver sets cookie on register.
- **Breaking change:** Path B is breaking for clients expecting user-only register; Path A is non-breaking.

## Implementation steps

V-18 is a verification issue. Steps below are for the **independent verifier** after P2-12 implementation is complete.

### Prerequisite gate

1. Confirm **P2-12 plan** frontmatter is `status: approved` and the approved path (`A` or `B`) is recorded in the plan body or approval comment.
2. Confirm P2-12 implementation exists (inspect `git diff`; read `docs/agent-reports/P2-12-implementation.md` if present, but do not trust it without code/doc inspection).
3. If P2-12 is not implemented, stop and return verdict **`changes-required`** with note: underlying documentation mismatch still open.
4. If runtime HTTP tests are required but API bootstrap fails due to **V-16/P1-06** DI defect, record bootstrap failure separately; do not conflate with P2-12 register contract unless register endpoint was reachable.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm only P2-12-scoped files changed (per approved path).
3. Record which path was implemented:
   - **Path A:** documentation files only; `register.usecase.ts` and `auth.controller.ts` unchanged.
   - **Path B:** use case, controller, DI factory, docs, and optional unit spec changed.

### Step 2 — Static contract trace

Document the approved contract:

| Path  | Expected `POST /auth/register` body                  | Expected session cookie                          | Expected doc grep                                           |
| ----- | ---------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| **A** | `{ success: true, data: { user } }` — no `data.auth` | No `Set-Cookie` on register                      | No «login або register» / «login or register» family claims |
| **B** | `{ success: true, data: { user, auth } }`            | `Set-Cookie: sid=...` when `AUTH_DRIVER=session` | Docs describe register auth same as login                   |

Static checks:

```bash
# Register use case auth dependency (Path A: no matches; Path B: match after transactionManager.run)
rg "AuthTokenService|createAuthSession" libs/application/src/use-cases/auth/register.usecase.ts

# Controller cookie attach on register (Path A: register has no attachIfNeeded; Path B: register calls attachIfNeeded)
rg -n "register|attachIfNeeded" apps/api/src/controllers/auth.controller.ts

# Residual doc drift (Path A: expect zero matches; Path B: docs may mention register+auth intentionally)
rg -n "login або register|login or register" README.md EXAMPLES.md MODULES_OVERVIEW_NON_TECH.md
```

Cross-read:

- `README.md` §6.3, §7, §16.1 — all three must agree on register contract.
- `EXAMPLES.md` §4 — must match actual `RegisterUseCase` pattern for chosen path.

### Step 3 — Documentation alignment matrix

For each location, record pass/fail against the approved path:

| Location                           | Path A pass condition                    | Path B pass condition                    |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `README.md` §16.1                  | Family created on login only             | Family created on login **and** register |
| `README.md` §7                     | Step documents `register → login`        | Step documents auth returned on register |
| `EXAMPLES.md` §4                   | User-only return; separate login example | `{ user, auth }` after commit            |
| `MODULES_OVERVIEW_NON_TECH.md` §26 | Register ≠ authenticate                  | Register returns auth like login         |

### Step 4 — Targeted unit verification (Path B only)

When Path B was implemented:

```bash
npm ci
npm run test:unit -- register.usecase
```

**Expected:** spec passes; `createAuthSession` invoked outside `transactionManager.run()`.

Path A: skip (no new unit spec expected).

### Step 5 — Runtime HTTP verification (mandatory when infrastructure available)

**Infrastructure required:** PostgreSQL, Redis, API bootstrapped (`npm run start:api` or test harness with same composition).

Use a unique email per run to avoid `USER_ALREADY_EXISTS`.

#### Path A scenarios

**5a. Register response (JWT or session driver — same body contract):**

```bash
curl -s -D - -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"v18-register-<timestamp>@example.com","password":"StrongPassword123!"}'
```

**Expected:**

- HTTP 2xx.
- JSON: `success: true`, `data.user` present with `id`, `email`, `roles`.
- JSON: `data.auth` **absent**.
- Response headers: **no** session cookie on register.

**5b. Follow-up login (JWT driver — `AUTH_DRIVER=jwt`):**

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<same-email>","password":"StrongPassword123!"}'
```

**Expected:** `data.auth.accessToken` and `data.auth.refreshToken` present.

**5c. Follow-up login (session driver — `AUTH_DRIVER=session`):**

```bash
curl -s -D - -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<same-email>","password":"StrongPassword123!"}'
```

**Expected:** `Set-Cookie` with configured session cookie name (default `sid`); `data.auth.sessionId` or equivalent in body per login contract.

#### Path B scenarios

**5d. Register with JWT driver:**

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"v18-autologin-<timestamp>@example.com","password":"StrongPassword123!"}'
```

**Expected:** `data.auth.accessToken` and `data.auth.refreshToken` present (same shape as login).

**5e. Register with session driver:**

```bash
curl -s -D - -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"v18-session-<timestamp>@example.com","password":"StrongPassword123!"}'
```

**Expected:** `Set-Cookie` with session cookie; auth payload in body.

**Negative control (optional):** on unfixed `main`, register curl shows `data.user` only while `README.md` §16.1 still mentions register — confirms V-18 would fail pre-fix.

### Step 6 — Build and lint (Path B or if code touched)

```bash
npm run build:api
npm run lint
```

Path A docs-only: optional sanity `npm run build:api` (no code change expected).

### Step 7 — Write verification report

Create `docs/agent-reports/V-18-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-18 — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Approved P2-12 path

A | B

## Scope checked

## Root-cause assessment

## Acceptance criteria matrix

## Documentation alignment

## Runtime HTTP evidence

## Commands executed

## Findings

## Remaining risks

## Unverified areas
```

Include per-scenario records from backlog §7 template:

```text
Issue ID: V-18
Command/scenario:
Expected result:
Actual result:
Exit code:
Evidence:
Verdict: approved | changes-required | not-confirmed
Unverified areas:
```

## Migration and rollout concerns

None for verification. Path B implementation has no DB migration; Path A is documentation-only.

## Targeted verification

| Command / scenario                             | Expected result                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Doc grep (`login або register`)                | Path A: zero matches; Path B: intentional register+auth wording only where accurate |
| Static trace `register.usecase.ts`             | Path A: no `createAuthSession`; Path B: call after transaction                      |
| Static trace `auth.controller.ts`              | Path A: register without `attachIfNeeded`; Path B: register with `attachIfNeeded`   |
| `curl POST /auth/register`                     | Response matches approved path contract                                             |
| Path A: `curl POST /auth/login` after register | Auth/session issued on login, not register                                          |
| Path B: register under session driver          | `Set-Cookie` on register                                                            |
| `npm run test:unit -- register.usecase`        | Path B: passes                                                                      |

## Full verification

| Command                                                     | Expected result                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm ci`                                                    | Clean install succeeds                                                      |
| `npm run build:api`                                         | API compiles (mandatory for Path B)                                         |
| `npm run lint`                                              | No new errors from P2-12 changes                                            |
| `npm run test:unit`                                         | Full suite passes, or pre-existing unrelated failures documented separately |
| `npm run start:api` + curl scenarios                        | Primary runtime evidence when PostgreSQL + Redis available                  |
| Both auth drivers (Path A login follow-up; Path B register) | JWT and session contracts documented and verified                           |

## Acceptance criteria

Mapped from P2-12 acceptance criteria:

| ID   | Criterion                                                                    | Verification method                                          | Pass condition                                            |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| AC-1 | P2-12 fix implemented for human-approved path                                | Diff + scope review                                          | Path A or B changes match approved plan                   |
| AC-2 | Documentation and runtime response for `POST /auth/register` agree           | Doc matrix + curl                                            | Body shape matches docs for chosen path                   |
| AC-3 | JWT and session drivers share the same documented contract                   | Read §16.1, EXAMPLES, MODULES_OVERVIEW; driver-specific curl | Both drivers described consistently; runtime matches      |
| AC-4 | Examples do not promise refresh/session family where code does not create it | `EXAMPLES.md` §4 + grep                                      | Path A: no false promises; Path B: promises match code    |
| AC-5 | `README.md` §6.3, §7, §16.1 internally consistent                            | Cross-read all three sections                                | No contradictory register auth claims                     |
| AC-6 | Path B: auth side effect after DB commit                                     | Unit spec or code review                                     | `createAuthSession` not inside `transactionManager.run()` |
| AC-7 | Path B: `npm run build:api` and `npm run lint` pass                          | Execute and record                                           | Exit 0                                                    |

**Verdict rules:**

- **`approved`** — AC-1 through AC-5 pass for the approved path; AC-6–AC-7 pass when Path B; runtime curl evidence obtained or explicitly unverified with infra note (not a code defect).
- **`changes-required`** — doc/code mismatch remains (e.g. §16.1 still says register creates family on Path A, or register returns no auth on Path B); or static trace contradicts approved path.
- **`not-confirmed`** — P2-12 not implemented; or curl/build could not run due to environment failure unrelated to P2-12 scope.

## Risks

1. **False approval from doc-only review** — V-18 requires runtime curl when API infra is available; grep alone is insufficient for AC-2.
2. **Path ambiguity** — verifier must confirm which P2-12 path was approved before judging pass/fail; Path A and Path B have opposite expectations.
3. **Blocked by V-16** — if API cannot bootstrap due to DI defect, runtime scenarios are unverified; separate from P2-12 static alignment but blocks full `approved` if human requires runtime evidence.
4. **Driver coverage gap** — verifying only JWT driver misses session cookie contract; AC-3 requires both drivers or explicit unverified note.
5. **P2-12 plan not approved** — P2-12 plan is currently `status: proposed`; implementation and V-18 verification blocked until human approval and path selection.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P2-12 implementer — no verifier code changes.

## Open questions requiring human decision

1. **Primary (blocks P2-12 implementation):** Approve **Path A** (docs-only, `register → login`) or **Path B** (code auto-login)? P2-12 plan recommends Path A; V-18 pass conditions depend on this choice.
2. **Verification ordering** — must V-18 wait for a separate P2-12 verification report, or is V-18 the canonical register-contract verification?
3. **Runtime bootstrap requirement** — is documentation + static trace sufficient for `approved` when PostgreSQL/Redis unavailable, or is curl mandatory whenever infra exists?
4. **V-16 dependency** — if API bootstrap fails on DI (P1-06), may V-18 return `approved` based on doc alignment + static code review only?
5. **Session driver test environment** — is a second API boot with `AUTH_DRIVER=session` required, or is documenting session behavior in EXAMPLES sufficient when JWT curl passes?

**Approval instruction:** Change plan frontmatter to `status: approved` before V-18 verification begins. Record the approved P2-12 path (`A` or `B`) in the approval comment or in this plan body.
