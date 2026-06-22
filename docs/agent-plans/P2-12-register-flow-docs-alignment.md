---
issue_id: P2-12
status: approved
owner: human-approval-required
---

# P2-12 — Align register flow with auth token/session documentation

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-12. Узгодити register flow з auth token/session документацією**.

Related verification scenario: backlog **V-18** — “Register endpoint response matches documented auth/session behavior”.

**Investigation (2026-06-22, current branch):** mismatch confirmed — `POST /auth/register` returns `{ user }` only; `README.md` §16.1 and `EXAMPLES.md` §4 imply auth/session creation on register. Issue is **not stale**.

## Current behavior

### HTTP layer — `AuthController`

| Endpoint              | Symbol                      | Behavior                                                                                                                                    |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register` | `AuthController.register()` | Calls `RegisterUseCase.execute(dto)` only. No `@Res`, no `SessionCookieService`. Returns `{ success: true, data: result }`.                 |
| `POST /auth/login`    | `AuthController.login()`    | Calls `LoginUseCase.execute(dto)`, then `SessionCookieService.attachIfNeeded(res, result.auth)`. Returns `{ success: true, data: result }`. |

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

**Actual register response:**

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

**Actual login response (JWT driver):** `{ success: true, data: { user, auth: { accessToken, refreshToken } } }`.

**Session driver:** login sets `sid` cookie via `SessionCookieService.attachIfNeeded()`; register does not.

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
    // ... hash password, transaction (insert user + UserRegisteredEvent) ...
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

Contrast: `LoginUseCase` (`libs/application/src/use-cases/auth/login.usecase.ts`) injects `IAuthTokenService` and returns `{ user, auth }`.

### DI — `AuthApplicationModule`

`RegisterUseCase` factory injects four tokens only: `UserRepository`, `PasswordHasher`, `TransactionManager`, `OutboxWriter` (`apps/api/src/composition/auth-application.module.ts`, lines 91–103). `LoginUseCase` additionally injects `AuthTokenService`.

### Tests

- No unit tests for `RegisterUseCase` or `LoginUseCase`.
- No API/integration tests for `POST /auth/register`.

## Confirmed root cause

**Documentation–implementation drift on the register auth contract**, not a broken login/session stack.

1. **Code path:** `RegisterUseCase` and `AuthController.register()` stop after user persistence + outbox; they never invoke `IAuthTokenService.createAuthSession()` or `SessionCookieService.attachIfNeeded()`.
2. **Docs path:** At least two prominent locations describe or exemplify post-register auth/session creation:
   - `README.md` line 2204 (§16.1 Token family): «При login або register створюється окрема refresh-token family.»
   - `EXAMPLES.md` §4 (lines 176–209): registration example calls `authTokenService.createAuthSession(...)` after commit and returns `{ user, auth }`.
3. **Internal README split:** §6.3 (lines 1597–1608) and §7 (lines 1658–1677) already describe user-only register (accurate); §16.1 does not.

## Dependency/runtime flow

### Current register flow

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

### Current login flow (contrast)

```text
POST /auth/login
  → LoginUseCase.execute()
      → IUserRepository.findByEmail()
      → IPasswordHasher.compare()
      → IAuthTokenService.createAuthSession(CurrentUser)
          → JWT: new familyId + token pair in Redis
          → Session: new sessionId in Redis
      → return { user, auth }
  → SessionCookieService.attachIfNeeded(res, auth)  [session driver only]
  → { success: true, data: { user, auth } }
```

### Async side effect (register only)

```text
UserRegisteredEvent (outbox)
  → Worker/Cron → DomainEventRouter
  → UserRegisteredEventHandler → QUEUES.EMAIL (welcome email)
```

Auth/session creation is **not** part of this chain.

## Goal

Make documentation and runtime behavior for `POST /auth/register` agree for both JWT and session drivers. Examples must not promise refresh/session family where code does not create it.

## Scope

**Recommended (Path A — docs-only):** Align documentation and examples with the existing user-only register contract; document explicit `register → login` flow for both auth drivers.

**Alternative (Path B — code auto-login):** Extend register code path to mirror login auth issuance; update docs accordingly. Requires human contract choice before implementation (see Open questions).

## Out of scope

- Email verification / confirm-before-login flows.
- OpenAPI/Swagger decorators (none exist on auth controller today).
- Idempotency changes on register (correctly excluded from `@Idempotent()` today).
- Changes to login, refresh, logout, or auth infrastructure beyond what Path B requires.

## Files to create

| Path                                                           | When        | Responsibility                                                                      |
| -------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `libs/application/src/use-cases/auth/register.usecase.spec.ts` | Path B only | Unit test: `createAuthSession` called after transaction commit, not inside `run()`. |

## Files to modify

### Path A (recommended — docs-only)

| Path                           | Symbol / section                              | Change                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                    | §16.1 Token family (line ~2204)               | Remove «або register»; state refresh-token family is created on **login** (and via refresh rotation), not register.                                                                                       |
| `README.md`                    | §7 Auth registration flow (lines ~1658–1677)  | Add explicit step 13: client must call `POST /auth/login` to obtain auth tokens / session cookie.                                                                                                         |
| `README.md`                    | §16.1 Token family diagram (lines ~2208–2216) | Keep `login` as entry point; optionally add note that register does not enter this chain.                                                                                                                 |
| `EXAMPLES.md`                  | §4 «Транзакція в use case» (lines ~176–209)   | Replace auto-login example with actual `RegisterUseCase` pattern (user insert + outbox, user-only return). Add follow-up subsection showing `register → login` curl examples for JWT and session drivers. |
| `MODULES_OVERVIEW_NON_TECH.md` | §26 Auth capabilities (~lines 460–483)        | One sentence: registration creates the account only; authentication is a separate login step.                                                                                                             |

### Path B (alternative — code auto-login)

| Path                                                      | Symbol / section                           | Change                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/application/src/use-cases/auth/register.usecase.ts` | `RegisterUseCase` constructor, `execute()` | Inject `IAuthTokenService`; after `transactionManager.run()` commits, call `createAuthSession` with `authVersion`; return `{ user, auth }`. |
| `apps/api/src/composition/auth-application.module.ts`     | `RegisterUseCase` factory                  | Add `TOKENS.AuthTokenService` to `inject` / `useFactory` (mirror `LoginUseCase`).                                                           |
| `apps/api/src/controllers/auth.controller.ts`             | `AuthController.register()`                | Add `@Res({ passthrough: true }) res: Response`; call `sessionCookieService.attachIfNeeded(res, result.auth)`.                              |
| `README.md`                                               | §6.3, §7, §16.1                            | Align all register sections with `{ user, auth }` response.                                                                                 |
| `EXAMPLES.md`                                             | §4                                         | Align with implementation; add register response example including `auth`.                                                                  |
| `MODULES_OVERVIEW_NON_TECH.md`                            | §26                                        | State register returns auth same as login.                                                                                                  |

## Files to delete

None.

## Contract and DI changes

| Path               | Contract changes                                                                   | DI changes                                                |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **A (docs-only)**  | None                                                                               | None                                                      |
| **B (auto-login)** | None — reuse `IAuthTokenService.createAuthSession` and existing `AuthTokens` shape | `RegisterUseCase` factory gains `TOKENS.AuthTokenService` |

**Transaction boundary (Path B only):** `createAuthSession` must run **after** `transactionManager.run()` commits — consistent with `EXAMPLES.md` §4 comment (“Redis / email / queue — після commit”). Auth Redis writes must not be inside the DB transaction.

## Implementation steps

### Path A (recommended — implement unless human selects Path B)

1. **Fix `README.md` §16.1 Token family**
   - Change line ~2204 from «При login або register…» to «При login створюється окрема refresh-token family.»
   - Add one sentence: register does not create a token family; use `POST /auth/login` after successful registration.

2. **Extend `README.md` §7 Auth registration flow**
   - After step 12 (welcome email), add step 13: «Client obtains auth via separate `POST /auth/login` (JWT tokens or session cookie depending on `AUTH_DRIVER`).»

3. **Rewrite `EXAMPLES.md` §4**
   - Replace the fictional auto-login snippet with the real register pattern: hash → transaction (insert + outbox) → return `{ user }` only.
   - Add new subsection **«4.1 Register then login»** with:
     - `curl` for `POST /auth/register` showing user-only response.
     - `curl` for `POST /auth/login` showing `{ user, auth }` (JWT) or session cookie note.

4. **Update `MODULES_OVERVIEW_NON_TECH.md` §26**
   - Clarify registration and login are separate steps.

5. **Cross-check consistency**
   - Grep `README.md`, `EXAMPLES.md`, `MODULES_OVERVIEW_NON_TECH.md` for «login або register», «login or register», and register+family claims.
   - Confirm §6.3 flow list (lines 1597–1608) remains accurate and consistent with §7 and §16.1.

### Path B (alternative — only if human approves auto-login contract)

1. Extend `RegisterUseCase` constructor to accept `IAuthTokenService`.
2. After successful transaction, call `createAuthSession` with `{ id, email, roles, authVersion: user.authVersion }` (mirror `LoginUseCase` mapping).
3. Return `{ user, auth }` from `execute()`.
4. Update `AuthApplicationModule` `RegisterUseCase` factory — add `TOKENS.AuthTokenService`.
5. Update `AuthController.register()` — add `@Res({ passthrough: true }) res: Response` and `sessionCookieService.attachIfNeeded(res, result.auth)`.
6. Add `register.usecase.spec.ts` — verify auth call happens outside transaction.
7. Update `README.md`, `EXAMPLES.md`, `MODULES_OVERVIEW_NON_TECH.md` to document `{ user, auth }` for register on both drivers.

## Migration and rollout concerns

| Path  | Concern                                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Documentation-only; no runtime or API contract change.                                                                                                      |
| **B** | **Breaking** for clients that expect user-only register response. User may exist in DB but no session if Redis fails post-commit — client must retry login. |

No database migrations required for either path.

## Targeted verification

### Path A

```bash
# No register+login combined claims remain
rg -n "login або register|login or register" README.md EXAMPLES.md MODULES_OVERVIEW_NON_TECH.md

# Register use case still has no auth dependency
rg "AuthTokenService|createAuthSession" libs/application/src/use-cases/auth/register.usecase.ts
# expect: no matches

# Controller register still has no cookie attach
rg -n "register|attachIfNeeded" apps/api/src/controllers/auth.controller.ts
```

Manual (if API running):

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"new@example.com","password":"StrongPassword123!"}'
# Expect: data.user present, data.auth absent
```

### Path B

```bash
rg "createAuthSession" libs/application/src/use-cases/auth/register.usecase.ts
# expect: match inside execute(), after transactionManager.run()

npm run build:api
npm run lint
npm run test:unit -- register.usecase
```

Manual JWT driver:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"new@example.com","password":"StrongPassword123!"}'
# Expect: data.auth.accessToken + data.auth.refreshToken
```

Manual session driver (`AUTH_DRIVER=session`): same call + `Set-Cookie: sid=...`.

## Full verification

| Path                | Commands                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **A (docs-only)**   | Doc grep checks above; no build required unless reviewer prefers sanity check. Optional: `npm run build:api` (unchanged code). |
| **B (code change)** | `npm run build`, `npm run lint`, `npm run test:unit`; optional `npm run start:api` + manual curl for both drivers.             |

Backlog verification: **V-18**.

## Acceptance criteria

| Criterion                                                                    | Path A evidence                                                    | Path B evidence                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Documentation and runtime response for `POST /auth/register` agree           | Doc grep clean; manual curl shows `data.user` only, no `data.auth` | Doc grep + curl shows `{ user, auth }`                 |
| JWT and session drivers share the same documented contract                   | Both docs describe `register → login` for both drivers             | Both docs describe auto-login; curl tests both drivers |
| Examples do not promise refresh/session family where code does not create it | `EXAMPLES.md` §4 fixed; no register+family claims                  | `EXAMPLES.md` shows family because code creates it     |

## Risks

| Risk                             | Path A                                             | Path B                                                 |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Breaking existing API consumers  | None                                               | **Yes** — response shape changes                       |
| Partial DB commit + auth failure | N/A                                                | User created but no session if Redis fails post-commit |
| Security posture                 | Explicit login step (common pattern)               | Auto-login reduces friction                            |
| Incomplete doc fix               | Residual «register creates auth» wording elsewhere | Docs must be updated in all sections                   |

## Rollback strategy

- **Path A:** Revert documentation commits only.
- **Path B:** Revert use case, controller, DI factory, tests, and documentation commits.

## Open questions requiring human decision

1. **Primary (blocks implementation):** Approve **Path A** (docs-only, `register → login`) or **Path B** (code auto-login)? This plan recommends **Path A** because existing code, `README.md` §6.3/§7, and common starter-kit patterns already treat register as account creation only.
2. **If Path B:** What HTTP status/body when user insert succeeds but `createAuthSession` fails? Options: `500`, `201` with user only + error hint, or require client to login. Plan assumes `500` (consistent with login auth failures) unless human specifies otherwise.
3. **If Path B:** Confirm unit test for `RegisterUseCase` is in scope (recommended yes).
4. Email verification before login is out of scope for both paths unless product requires it.

**Approval instruction:** Change plan frontmatter to `status: approved` and note chosen path (`A` or `B`) in the approval comment or plan body before implementation begins.
