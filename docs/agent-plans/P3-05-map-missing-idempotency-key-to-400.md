---
issue_id: P3-05
status: approved
owner: human-approval-required
---

# P3-05 — Map missing `Idempotency-Key` to HTTP 400 instead of 409

## Source issue

- Backlog ID: `P3-05`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-05
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Low — missing `Idempotency-Key` → `ConflictError` → HTTP 409)
- Classification: Confirmed defect (still present on current `main`, inspected 2026-08-02)

## Current behavior

Confirmed on current branch (inspected; no production code changed for this plan):

1. `libs/infrastructure/src/idempotency/idempotency.interceptor.ts` (`IdempotencyInterceptor.intercept`):
   - Opt-in via `@Idempotent()` metadata (`IDEMPOTENT_KEY` from `idempotent.decorator.ts`).
   - Missing / empty `Idempotency-Key` header throws `new ConflictError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')`.
   - Invalid format (length / charset after trim) throws `new ConflictError('INVALID_IDEMPOTENCY_KEY', ...)`.
2. `libs/infrastructure/src/exceptions/global-exception.filter.ts` (`GlobalExceptionFilter.status`):
   - `ConflictError` → `HttpStatus.CONFLICT` (409).
   - `ValidationError` → `HttpStatus.BAD_REQUEST` (400).
3. True runtime conflicts from `libs/infrastructure/src/idempotency/idempotency.service.ts` (`RedisIdempotencyService`) correctly use `ConflictError` (`IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `IDEMPOTENCY_OUTCOME_UNKNOWN`) and should stay 409.
4. No shipped controller currently applies `@Idempotent()` (repo-wide grep clean under `apps/` / `libs/` for decorator usage). Global interceptor is still registered in `apps/api/src/api.module.ts` (`APP_INTERCEPTOR` → `IdempotencyInterceptor`).
5. Docs mismatch: `EXAMPLES.md` §7 states missing key returns `409` and groups “Missing / invalid” under a “Typical error code (HTTP 409)” table column.
6. Postman (`docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json`) has **no** Idempotency-Key requests or 409 assertions for this case (UUID variable at L45 is `sessionId`, unrelated).
7. OpenAPI (`apps/api/src/openapi/create-openapi-document.ts`) does not document `Idempotency-Key` / `IDEMPOTENCY_KEY_REQUIRED` status semantics. No interceptor unit spec exists.

## Confirmed root cause

Client-request validation (missing or malformed required header) is modeled as `ConflictError`, so `GlobalExceptionFilter` maps it to HTTP 409. Missing required header is not a resource-state conflict; it should use a validation-style error that maps to HTTP 400 (`ValidationError`).

## Dependency/runtime flow

```text
HTTP handler with @Idempotent()
  -> IdempotencyInterceptor.intercept
       -> Reflector metadata IDEMPOTENT_KEY
       -> read header Idempotency-Key
            missing/empty  -> ConflictError(IDEMPOTENCY_KEY_REQUIRED)   // BUG → 409 today
            invalid format -> ConflictError(INVALID_IDEMPOTENCY_KEY)    // same class of client validation
            valid          -> IIdempotencyService.execute(...)
                               -> ConflictError(IDEMPOTENCY_* conflict/unknown) // keep 409
  -> GlobalExceptionFilter
       ConflictError    -> 409
       ValidationError  -> 400
```

Composition (unchanged by this fix):

```text
ApiModule
  -> IdempotencyModule.register({ imports: [redisModule] })
  -> APP_INTERCEPTOR useClass: IdempotencyInterceptor
  -> ExceptionsModule → APP_FILTER GlobalExceptionFilter
```

## Goal

Missing (and, by recommendation, invalid) `Idempotency-Key` on `@Idempotent()` routes returns HTTP **400** with the same error codes (`IDEMPOTENCY_KEY_REQUIRED` / `INVALID_IDEMPOTENCY_KEY`), while true idempotency conflicts remain HTTP **409**. Align EXAMPLES, OpenAPI description, and Postman collection text with that contract; cover with unit tests.

## Scope

- Change error **type** thrown by `IdempotencyInterceptor` for header absence/format validation from `ConflictError` to `ValidationError` (codes and messages unchanged).
- Add unit tests for the interceptor status-mapping path (error class/code; optionally filter mapping already covered elsewhere).
- Update integrator docs (`EXAMPLES.md` §7; README only if it incorrectly claims 409 for missing key — today it does not for that case).
- Update OpenAPI document description (and optionally a small contract assertion) so the machine-facing contract states missing/invalid key → 400.
- Update Postman collection description so it does not imply 409 for missing key; run `npm run test:postman-coverage`.
- Keep `RedisIdempotencyService` conflict/`OUTCOME_UNKNOWN` paths on `ConflictError` → 409.

## Out of scope

- Changing `GlobalExceptionFilter` mapping tables or introducing new error classes.
- Changing `IIdempotencyService` / Redis fence / lock / result behavior (P1-03 already done).
- Applying `@Idempotent()` to existing auth/session routes or inventing a demo endpoint solely for OpenAPI route-level decorators.
- Worker/Cron/job-execution store (`IJobExecutionStore`) paths.
- Other backlog issues (P2-16…P2-25, P3-06+, etc.).
- `package-lock.json`, migrations, env schema.

### HTTP / OpenAPI / Postman

This fix **changes HTTP status codes** for the `@Idempotent()` + missing/invalid `Idempotency-Key` contract. Even though no current shipped route uses `@Idempotent()`, AC-03 and workspace HTTP-contract rules require:

1. **OpenAPI:** document the status/code contract on the generated document (root description in `create-openapi-document.ts`; no per-route `@ApiBadRequestResponse` until a route opts in — do not invent a fake path).
2. **Postman:** align collection `info.description` (and any future Idempotency notes) with 400 for missing/invalid key; there are currently no request items asserting 409 for this case to rewrite.
3. **Verification:** `npm run test:postman-coverage` must pass after doc/collection edits.

## Files to create

| Path | Symbol / responsibility |
| --- | --- |
| `libs/infrastructure/src/idempotency/idempotency.interceptor.spec.ts` | Unit tests for `IdempotencyInterceptor`: missing key → `ValidationError` / `IDEMPOTENCY_KEY_REQUIRED`; invalid key → `ValidationError` / `INVALID_IDEMPOTENCY_KEY` (if in scope); enabled=false bypass; valid key delegates to `IIdempotencyService.execute` without throwing validation errors. |

## Files to modify

| Path | Symbol / responsibility |
| --- | --- |
| `libs/infrastructure/src/idempotency/idempotency.interceptor.ts` | `IdempotencyInterceptor.intercept`: replace `ConflictError` with `ValidationError` for `IDEMPOTENCY_KEY_REQUIRED` and (recommended) `INVALID_IDEMPOTENCY_KEY`; update import from `@domain/errors/domain-errors`. |
| `EXAMPLES.md` | §7: change “поверне `409`” → `400` for missing key; adjust Client retry contract table so missing/invalid are HTTP 400 (not under a blanket “HTTP 409” column); keep true conflicts / `OUTCOME_UNKNOWN` as 409. |
| `apps/api/src/openapi/create-openapi-document.ts` | `createOpenApiDocument` / `DocumentBuilder.setDescription`: add a short Idempotency paragraph — `@Idempotent()` requires `Idempotency-Key`; missing/invalid → **400** (`IDEMPOTENCY_KEY_REQUIRED` / `INVALID_IDEMPOTENCY_KEY`); key reuse / in-progress / unknown outcome → **409**. |
| `apps/api/src/openapi/openapi-contract.spec.ts` | Assert generated OpenAPI `info.description` (or equivalent) mentions the 400 missing-key / 409 conflict split so the contract cannot regress silently. |
| `docs/postman/NestJS-Backend-Foundation-Starter.postman_collection.json` | `info.description`: document that when a route uses `@Idempotent()`, missing/invalid `Idempotency-Key` yields **400** (not 409); true idempotency conflicts remain 409. Do not add a non-OpenAPI route item. |
| `README.md` | Touch **only if** implementer finds wording that claims 409 for missing `Idempotency-Key` (current §5.17 / §18 do not; §5.17 correctly documents `IDEMPOTENCY_OUTCOME_UNKNOWN` as 409 — leave that). Prefer no README edit if already accurate. |

## Files to delete

None.

## Contract and DI changes

| Area | Change |
| --- | --- |
| Domain error types | No new classes. Reuse `ValidationError` for header validation; keep `ConflictError` for service-level idempotency conflicts. |
| Ports / tokens | None. `TOKENS.IdempotencyService`, `IIdempotencyService` unchanged. |
| Nest DI / modules | None. `IdempotencyModule.register`, `APP_INTERCEPTOR`, `ExceptionsModule` registrations unchanged. |
| Public HTTP status | **Breaking for clients** that treated missing/invalid `Idempotency-Key` as 409: same error `code` strings, status becomes 400. |
| OpenAPI | Description-level contract update (no new path, no schema field rename). |
| Postman | Description-level alignment; coverage inventory unchanged (no new method/path). |

## Implementation steps

1. **Interceptor error type**
   - In `idempotency.interceptor.ts`, import `ValidationError` instead of (or in addition to, if unused then drop) `ConflictError`.
   - Throw `ValidationError('IDEMPOTENCY_KEY_REQUIRED', ...)` when `!key`.
   - **Recommended (same PR):** throw `ValidationError('INVALID_IDEMPOTENCY_KEY', ...)` for format failures — same client-validation class; avoids leaving invalid key as misleading 409. If human rejects (open question), leave invalid on `ConflictError` and document the split.
2. **Unit tests**
   - Add `idempotency.interceptor.spec.ts` with Reflector + mock `IIdempotencyService`.
   - Cover: not enabled → `next.handle()` only; missing header → `ValidationError` with code `IDEMPOTENCY_KEY_REQUIRED`; invalid key → expected class/code; valid key → `execute` called with trimmed key / scope / hash.
   - Do **not** change `idempotency.service.spec.ts` conflict expectations (still `ConflictError`).
3. **Docs**
   - Fix `EXAMPLES.md` §7 status and retry table HTTP columns.
   - Skip README unless a false “missing → 409” claim is found.
4. **OpenAPI**
   - Extend `DocumentBuilder.setDescription` in `create-openapi-document.ts` with Idempotency status semantics.
   - Extend `openapi-contract.spec.ts` with a focused assertion on that wording (400 for missing/invalid; 409 for conflicts / unknown outcome).
5. **Postman**
   - Update collection `info.description` Idempotency note to 400 for missing/invalid key.
   - Run `npm run test:postman-coverage` (must remain green; no new uncovered OpenAPI routes).
6. **Do not** alter `GlobalExceptionFilter` or service conflict throws.

## Migration and rollout concerns

- **Client compatibility:** Integrators or SDKs that branch on HTTP 409 for `IDEMPOTENCY_KEY_REQUIRED` / `INVALID_IDEMPOTENCY_KEY` must switch to 400 (or branch on `error.code`). Prefer documenting as a deliberate status correction in release notes / EXAMPLES.
- **Error codes unchanged** — only HTTP status mapping changes via error class.
- No DB/Redis/migration impact; no env changes.
- No shipped starter route currently exposes the behavior; impact is on forks/apps that already use `@Idempotent()`.

## Targeted verification

| Command | Purpose |
| --- | --- |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/idempotency/idempotency.interceptor.spec.ts` | AC-01 interceptor throws `ValidationError` for missing key. |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/idempotency/idempotency.service.spec.ts` | AC-02 conflict paths still `ConflictError`. |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/exceptions/global-exception.filter.spec.ts` | Confirm `ValidationError` → 400 mapping still holds (existing test). |
| `npx jest --config jest.unit.config.ts apps/api/src/openapi/openapi-contract.spec.ts` | AC-03 OpenAPI description / contract assertion. |
| `npm run test:postman-coverage` | AC-03 Postman vs OpenAPI path coverage still green. |
| Grep / static read | Confirm interceptor no longer throws `ConflictError` for header validation; service still does for conflicts. |

## Full verification

| Command | Purpose |
| --- | --- |
| `npm run build` | Shared infra + API compile after interceptor/docs-adjacent OpenAPI change. |
| `npm run lint` | No new lint debt. |
| `npm run test:unit` | Full unit gate including new interceptor spec + OpenAPI contract. |
| `npm run test:module` | Ensure ApiModule / ExceptionsModule bootstrap unchanged. |

Not required for acceptance: `test:int`, live API bootstrap with Redis (no shipped `@Idempotent()` route to hit; unit evidence is sufficient for AC-01/02). Optional manual check: temporary local `@Idempotent()` probe **must not** be committed.

## Acceptance criteria

- **AC-01:** Missing `Idempotency-Key` on `@Idempotent()` routes returns HTTP 400 (`ValidationError` → filter), code `IDEMPOTENCY_KEY_REQUIRED`. Met by interceptor change + unit test (+ existing filter mapping).
- **AC-02:** True idempotency conflicts remain 409 (`IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `IDEMPOTENCY_OUTCOME_UNKNOWN` stay `ConflictError`). Met by no service changes + existing/updated service unit coverage.
- **AC-03:** OpenAPI and Postman aligned with the new status (description-level contract + coverage check). Met by `create-openapi-document.ts`, `openapi-contract.spec.ts`, Postman `info.description`, and `npm run test:postman-coverage`.
- **Docs:** `EXAMPLES.md` no longer claims missing key → 409.

## Risks

- **Silent client break** for callers that key off 409 for missing header (mitigate via EXAMPLES / OpenAPI / Postman wording and stable `error.code`).
- Leaving `INVALID_IDEMPOTENCY_KEY` on 409 while fixing only missing creates an inconsistent API (mitigate by fixing both unless human declines).
- Description-only OpenAPI update does not put `400` on a specific `paths.*` operation until a route uses `@Idempotent()` + decorators — acceptable for this starter; call out in risks, not as incomplete AC-03 if root description + EXAMPLES + Postman are updated.

## Rollback strategy

Revert the interceptor import/throw change and the doc/OpenAPI/Postman/spec edits in a single revert commit. No data migration to undo. Clients that already switched to 400 would need to accept 409 again only if rolled back.

## Open questions requiring human decision

1. **Invalid key status:** Should `INVALID_IDEMPOTENCY_KEY` also move to `ValidationError` → 400 (recommended: **yes**, same client-validation class and EXAMPLES grouping), or only `IDEMPOTENCY_KEY_REQUIRED` per the issue title?
2. **OpenAPI depth:** Is root `DocumentBuilder` description + contract-spec assertion sufficient for AC-03, or must implementers also add a reusable decorator helper (e.g. `ApiIdempotentContract()` wrapping `@ApiHeader` + `@ApiBadRequestResponse` + `@ApiConflictResponse`) for future `@Idempotent()` routes? **Recommendation:** description + assertion only in this fix; reusable decorator is optional follow-up, not required to close P3-05.
3. **Breaking-change callout:** Should README §5.17 gain an explicit one-line note that missing/invalid key is **400** (even though it does not currently claim 409), for discoverability? **Recommendation:** optional; EXAMPLES + OpenAPI description are enough unless human wants README parity.
