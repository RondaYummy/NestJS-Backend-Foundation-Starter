---
issue_id: P3-10
status: approved
owner: human-approval-required
---

# P3-10 — Map AuthGuard failures through AppError envelope

## Source issue

- Backlog ID: `P3-10`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-10
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (compact backlog: `AuthGuard` throws Nest `UnauthorizedException` instead of domain `AuthenticationError`)
- Classification: Architectural risk (still present on current branch, inspected 2026-08-02)

## Current behavior

Confirmed on current branch (inspected; no production code changed for this plan):

1. `apps/api/src/guards/auth.guard.ts` (`AuthGuard.canActivate`):
   - Missing Bearer token / session cookie → `throw new UnauthorizedException('Unauthorized')`.
   - `IAuthTokenService.verifyAccessToken(...)` returns `null` → same Nest `UnauthorizedException`.
   - Does **not** throw `AuthenticationError` (or any other `AppError`).
2. Token adapters return `null` on invalid/missing/stale access credentials (they do not throw for verify failures):
   - `libs/infrastructure/src/auth/jwt-auth-token.service.ts` (`JwtAuthTokenService.verifyAccessToken`)
   - `libs/infrastructure/src/auth/session-auth-token.service.ts` (`SessionAuthTokenService.verifyAccessToken`)
3. `libs/infrastructure/src/exceptions/global-exception.filter.ts` (`GlobalExceptionFilter`):
   - `AuthenticationError` → HTTP 401 with `{ success: false, error: { code, message, details } }` from the AppError branch.
   - `HttpException` / `UnauthorizedException` → HTTP 401 via the Nest branch; for `UnauthorizedException('Unauthorized')` Nest’s `getResponse()` is `{ message, error: 'Unauthorized', statusCode: 401 }`, so the filter currently emits `code: 'UNAUTHORIZED'` (from `body.error`) and a message of `'Unauthorized'`.
4. Other auth failures already use domain `AuthenticationError` (examples: `INVALID_REFRESH_TOKEN`, `AUTH_VERSION_MISMATCH`, `GOOGLE_SSO_*`, `REFRESH_TOKEN_NOT_SUPPORTED`), so clients that treat AppError codes as the contract see a different exception class path for guard failures.
5. Sibling inconsistency (related, not named in the issue title): `apps/api/src/controllers/sessions.controller.ts` (`requireSessionCookie`) also throws `UnauthorizedException('Unauthorized')` when the session cookie is missing after `AuthGuard` succeeded (e.g. Bearer-only).
6. OpenAPI already documents guarded 401s as `ErrorEnvelopeDto` (`@ApiUnauthorizedResponse` on `AuthController` / `SessionsController`); no stable AuthGuard error **code** is named in those descriptions. `ErrorDto` example uses `INVALID_CREDENTIALS` (login validation), not a guard code.
7. No `AuthGuard` unit spec exists. `global-exception.filter.spec.ts` covers `ValidationError` / `NotFoundError` / generic `HttpException` / unexpected `Error`, but **not** `AuthenticationError` → 401.
8. Postman collection has no assertions on AuthGuard 401 body/code.

## Confirmed root cause

`AuthGuard` throws Nest `UnauthorizedException` instead of domain `AuthenticationError`. Guard failures therefore take the `HttpException` mapping branch in `GlobalExceptionFilter`, while other auth failures take the `AuthenticationError` / `AppError` branch. Status is already 401 in both cases; the defect is mixed exception types and an inconsistent AppError mapping path (and potentially different `details` / code derivation rules if Nest’s response shape changes).

## Dependency/runtime flow

```text
HTTP request to @UseGuards(AuthGuard, ...)
  -> AuthGuard.canActivate
       -> extractTokenOrSessionId (Bearer or session cookie)
            missing  -> UnauthorizedException('Unauthorized')   // BUG: Nest path
       -> IAuthTokenService.verifyAccessToken(tokenOrSessionId)
            null     -> UnauthorizedException('Unauthorized')   // BUG: Nest path
            user     -> request.user = user; return true
  -> GlobalExceptionFilter.catch
       AuthenticationError -> 401 + AppError envelope (code from constructor)
       UnauthorizedException (HttpException)
         -> 401 + HTTP_ERROR branch (code from Nest body.error → 'UNAUTHORIZED')
```

Composition (unchanged by this fix):

```text
ApiModule
  -> AuthApplicationCompositionModule.register(...)  // TOKENS.AuthTokenService
  -> controllers use @UseGuards(AuthGuard) (Nest resolves guard deps)
  -> ExceptionsModule → APP_FILTER GlobalExceptionFilter
```

Consumers of `AuthGuard` today:

- `apps/api/src/controllers/auth.controller.ts` — `GET /v1/auth/me`, `POST /v1/auth/change-password`
- `apps/api/src/controllers/sessions.controller.ts` — all `/v1/sessions*` routes
- `EXAMPLES.md` sample snippets (documentation only)

## Goal

Unauthenticated / invalid-credential failures from `AuthGuard` throw `AuthenticationError`, pass through the same `GlobalExceptionFilter` AppError path as other auth failures, remain HTTP **401**, and keep OpenAPI (and Postman text if present) aligned with that envelope and stable error code.

## Scope

- Change `AuthGuard` to throw `AuthenticationError` instead of `UnauthorizedException` for both missing credential and `verifyAccessToken === null` cases.
- Choose one stable error `code` + message (see open questions; recommendation below).
- Add unit coverage for `AuthGuard` throws and for `GlobalExceptionFilter` `AuthenticationError` → 401 envelope.
- Align OpenAPI `@ApiUnauthorizedResponse` descriptions on guarded routes (and optionally root OpenAPI description) so the documented 401 envelope names the AuthGuard code.
- Align Postman collection wording if it documents AuthGuard/401 bodies; run `npm run test:postman-coverage`.
- **Recommended same PR:** replace `UnauthorizedException` in `SessionsController.requireSessionCookie` with the same `AuthenticationError` so session-management 401s stay consistent (see open question 2).

## Out of scope

- Changing `IAuthTokenService.verifyAccessToken` to throw instead of returning `null`.
- Changing login credential failures (`ValidationError('INVALID_CREDENTIALS')` → 400) or refresh/Google SSO `AuthenticationError` codes.
- Changing `GlobalExceptionFilter` status tables or HttpException mapping for unrelated Nest exceptions.
- New endpoints, auth drivers, guards beyond `AuthGuard` (+ optional `requireSessionCookie`).
- Worker / Cron / Migrations entrypoints (no `AuthGuard`).
- Other backlog issues (P3-05…P3-09, P3-11+, P2-*).
- `package-lock.json`, migrations, env schema.

### HTTP / OpenAPI / Postman

This fix **changes the exception type (and possibly `error.code` / message)** for existing guarded routes’ 401 responses. Per AC-03 and workspace HTTP-contract rules:

1. **OpenAPI:** update `@ApiUnauthorizedResponse` descriptions on AuthGuard-protected operations to name the stable AppError code; keep `type: ErrorEnvelopeDto`. Optionally note AuthGuard 401 semantics in `create-openapi-document.ts` root description.
2. **Postman:** align collection `info.description` (or any 401 notes) with the AppError envelope / code; do not invent new request items solely for this fix unless useful.
3. **Verification:** `npm run test:postman-coverage` must pass after collection/OpenAPI-adjacent edits.

## Files to create

| Path | Symbol / responsibility |
| --- | --- |
| `apps/api/src/guards/auth.guard.spec.ts` | Unit tests for `AuthGuard.canActivate`: missing credential → `AuthenticationError` with agreed code; `verifyAccessToken` null → same; successful verify sets `request.user` / request-context user id and returns `true`. Mock `IAuthTokenService`, `RequestContextService`, `AppConfigService`. |

## Files to modify

| Path | Symbol / responsibility |
| --- | --- |
| `apps/api/src/guards/auth.guard.ts` | `AuthGuard.canActivate`: replace `UnauthorizedException` with `AuthenticationError` from `@domain/errors/domain-errors`; drop unused Nest unauthorized import. |
| `libs/infrastructure/src/exceptions/global-exception.filter.spec.ts` | Add case: `AuthenticationError` → HTTP 401 + `{ success: false, error: { code, message, details: {} } }` without `Unexpected error` log. |
| `apps/api/src/controllers/auth.controller.ts` | `@ApiUnauthorizedResponse` on `me` / `change-password`: mention AuthGuard AppError code (e.g. `UNAUTHORIZED`) in description text so OpenAPI matches runtime. |
| `apps/api/src/controllers/sessions.controller.ts` | `@ApiUnauthorizedResponse` descriptions: mention same AuthGuard code; **if OQ-2 approved**, `requireSessionCookie` throws `AuthenticationError` instead of `UnauthorizedException`. |
| `apps/api/src/openapi/create-openapi-document.ts` | Optional: one sentence in `DocumentBuilder.setDescription` that missing/invalid access credentials on guarded routes return **401** with AppError code `UNAUTHORIZED` (or chosen code). |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Optional focused assertion that guarded 401 responses remain documented (`ErrorEnvelopeDto` / description mentions chosen code) so the contract cannot regress silently. |
| `apps/api/src/dto/common/error-envelope.dto.ts` | Optional: adjust `ErrorDto` `@ApiProperty` example only if human wants a guard-oriented example; **not required** (current example is login `INVALID_CREDENTIALS`). Prefer leaving examples unchanged unless OpenAPI reviewers ask. |
| `docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json` | `info.description` (or auth folder notes): state that guarded routes return the standard error envelope with the chosen AuthGuard code on 401. No new uncovered OpenAPI routes. |

## Files to delete

None.

## Contract and DI changes

| Area | Change |
| --- | --- |
| Domain error types | No new classes. Reuse `AuthenticationError`. |
| Ports / tokens | None. `TOKENS.AuthTokenService` / `IAuthTokenService` unchanged. |
| Nest DI / modules | None. `AuthGuard` remains request-scoped via `@UseGuards`; no new providers. |
| Public HTTP | Status stays **401**. Outer envelope stays `{ success: false, error: { code, message, details } }`. Exception type becomes `AuthenticationError`. If code stays `UNAUTHORIZED` and message stays `Unauthorized`, client-visible JSON is effectively unchanged vs today’s Nest mapping; if a different code/message is chosen, that is a deliberate contract tweak. |
| OpenAPI / Postman | Description-level alignment with AppError AuthGuard code; no new paths. |

## Implementation steps

1. **AuthGuard throw path**
   - Import `AuthenticationError` from `@domain/errors/domain-errors`.
   - Replace both `UnauthorizedException` throws with `new AuthenticationError(<CODE>, <MESSAGE>)`.
   - **Recommended defaults (pending OQ-1):** code `UNAUTHORIZED`, message `Unauthorized` — preserves today’s client-visible `error.code` / message while switching to the AppError filter branch.
2. **Optional sessions cookie hard-require (OQ-2)**
   - In `requireSessionCookie`, throw the same `AuthenticationError` instead of `UnauthorizedException`.
3. **Unit tests**
   - Add `auth.guard.spec.ts` covering missing token, null verify, success path.
   - Extend `global-exception.filter.spec.ts` with `AuthenticationError` → 401 AppError body.
4. **OpenAPI**
   - Update `@ApiUnauthorizedResponse` descriptions on guarded Auth/Sessions operations to name the code.
   - Optionally extend root description + `openapi-contract.spec.ts` assertion.
5. **Postman**
   - Align collection description with AppError AuthGuard 401 code.
   - Run `npm run test:postman-coverage`.
6. **Do not** change token adapters’ `null` verify semantics or filter status tables.

## Migration and rollout concerns

- **Client compatibility:** If code/message remain `UNAUTHORIZED` / `Unauthorized`, JSON body should match current Nest-mapped output for the common case; only the internal exception type changes. If a new code is chosen, clients branching on `error.code === 'UNAUTHORIZED'` must update.
- No DB/Redis/migration/env impact.
- Applies to all AuthGuard-protected routes (`/v1/auth/me`, `/v1/auth/change-password`, `/v1/sessions*`).

## Targeted verification

| Command | Purpose |
| --- | --- |
| `npx jest --config jest.unit.config.ts apps/api/src/guards/auth.guard.spec.ts` | AC-01 AuthGuard throws `AuthenticationError`. |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/exceptions/global-exception.filter.spec.ts` | AC-01/AC-02 filter maps `AuthenticationError` → 401 envelope. |
| `npx jest --config jest.unit.config.ts apps/api/src/openapi/openapi-contract.spec.ts` | AC-03 OpenAPI still documents 401 / envelope (and code wording if asserted). |
| `npm run test:postman-coverage` | AC-03 Postman vs OpenAPI path coverage still green. |
| Grep / static read | Confirm `AuthGuard` no longer imports/throws `UnauthorizedException`; optional sessions cookie path aligned if in scope. |

## Full verification

| Command | Purpose |
| --- | --- |
| `npm run build:api` | API compile after guard / OpenAPI description edits. |
| `npm run lint` | No new lint debt. |
| `npm run test:unit` | Full unit gate including new AuthGuard + filter specs. |
| `npm run test:module` | ApiModule / ExceptionsModule bootstrap unchanged. |

Not required for acceptance: `test:int`, live API bootstrap (unit evidence of throw type + filter mapping is sufficient). Optional manual `GET /v1/auth/me` without credentials to confirm 401 JSON shape.

## Acceptance criteria

- **AC-01:** Unauthenticated guarded requests use the same error envelope as other AppError auth failures (`AuthenticationError` → `GlobalExceptionFilter` AppError branch: `{ success: false, error: { code, message, details } }`). Met by AuthGuard change + unit tests.
- **AC-02:** Status remains **401** for unauthenticated access. Met by existing `AuthenticationError` → `HttpStatus.UNAUTHORIZED` mapping + filter unit test.
- **AC-03:** OpenAPI/docs match the envelope (guarded `@ApiUnauthorizedResponse` / optional root description name the AppError code; Postman text aligned; `npm run test:postman-coverage` green).

## Risks

- Choosing a **new** error code breaks clients that already depend on Nest-derived `UNAUTHORIZED` (mitigate by keeping `UNAUTHORIZED` unless human prefers a rename).
- Leaving `SessionsController.requireSessionCookie` on `UnauthorizedException` preserves a second Nest 401 path on session routes (mitigate by including OQ-2 in the same PR).
- Description-only OpenAPI updates do not add response examples with the concrete code unless decorators/examples are expanded — acceptable if descriptions + `ErrorEnvelopeDto` schema remain accurate.

## Rollback strategy

Revert the AuthGuard (and optional sessions controller) throw/import changes plus OpenAPI/Postman/spec edits in a single revert commit. No data migration to undo.

## Open questions requiring human decision

1. **Error code and message:** Keep Nest-compatible `AuthenticationError('UNAUTHORIZED', 'Unauthorized')` (**recommended** — minimal client churn), or introduce a clearer code such as `UNAUTHENTICATED` / `AUTHENTICATION_REQUIRED`, and/or distinct codes for missing credential vs invalid/expired token?
2. **Sessions cookie hard-require:** Include `SessionsController.requireSessionCookie` in this fix so it also throws `AuthenticationError` (**recommended: yes**, same 401 envelope on `/v1/sessions*`), or leave it as Nest `UnauthorizedException` and treat as a follow-up?
3. **OpenAPI depth:** Are updated `@ApiUnauthorizedResponse` descriptions (+ optional root sentence / contract assertion) sufficient for AC-03, or must `ErrorDto` examples / per-route response examples show the AuthGuard code? **Recommendation:** descriptions + existing `ErrorEnvelopeDto` schema; no example churn required.
