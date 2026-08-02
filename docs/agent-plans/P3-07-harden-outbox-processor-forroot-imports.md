---
issue_id: P3-07
status: approved
owner: human-approval-required
---

# P3-07 — Harden `OutboxProcessorModule.forRoot` against empty connection imports

## Source issue

- Backlog ID: `P3-07`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-07
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Low — `OutboxProcessorModule.forRoot` builds feature imports with empty `connectionImports`)

## Current behavior

Confirmed on current `main` (inspected 2026-08-02):

1. `libs/infrastructure/src/outbox/outbox-processor.module.ts` — `OutboxProcessorModule.forRoot(options?, features?)`:
   - builds options via `OutboxProcessorOptionsModule.forRoot(options)`;
   - calls `buildFeatureImports([], features?.eventHandlers)` — **hardcoded empty** `connectionImports`;
   - there is **no** parameter for Drizzle / BullMQ / other peer modules on the sync API.
2. `forRootAsync(options, features?)` correctly takes `connectionImports = options.imports ?? []` and forwards them into `buildFeatureImports`. Empty / omitted `imports` still silently becomes `[]` (same incomplete Audit/Events graph).
3. `buildFeatureImports` always registers:
   - `AuditModule.register({ imports: connectionImports })`;
   - `EventsModule.register({ imports: connectionImports, handlers })`;
   - plus spreads `connectionImports` on the processor module itself.
4. `DrizzleOutboxProcessor` injects `DRIZZLE_DB`, `TOKENS.AuditLogger`, `TOKENS.DomainEventRouter`, `AppLogger`, `TOKENS.OutboxProcessorOptions`. Handlers (e.g. `UserRegisteredEventHandler`) typically need `TOKENS.QueueGateway` from BullMQ queue registration. Without connection imports inside the dynamic module graph, those tokens are not wired through Audit/Events unless a **sibling / global** module happens to export them.
5. Production Worker (`apps/worker/src/worker.module.ts`) uses **only** `OutboxProcessorModule.forRootAsync({ imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule], ... }, { eventHandlers: [...] })` — correct path today.
6. Sync `forRoot` consumers in-repo: **only** `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` (two tests). Those tests import a `@Global()` `MockConnectionModule` as a **sibling** of `forRoot(...)`, so they compile despite empty internal connection imports — masking the footgun integrators hit when copying the sync API without a global mock.
7. Docs:
   - `docs/infrastructure-modules/README.md` matrix lists `forRoot` / `forRootAsync` without stating that sync `forRoot` cannot supply connection imports;
   - `docs/infrastructure-modules/EXTRACTION_GUIDE.md` § OutboxProcessorModule already says prefer `forRootAsync` with drizzle/queue imports (Worker pattern), but still documents bare `forRoot(options?, features?)`;
   - `README.md` mentions Worker `forRootAsync` only (no sync example).

## Confirmed root cause

The public sync registration API (`forRoot`) **cannot** accept connection/feature peer imports and always builds Audit + Events with `connectionImports = []`. That looks type-valid and may even compile in tests that rely on sibling/`@Global()` providers, but it is an incomplete Nest graph for real composition. Integrators who copy sync `forRoot` get a runtime DI / mis-wiring footgun. `forRootAsync` already supports imports (Worker is fine) but still allows omitting them without a registration-time guard.

## Dependency/runtime flow

```text
OutboxProcessorModule.forRoot(options, features?)     // TODAY
  -> OutboxProcessorOptionsModule.forRoot(options)
  -> buildFeatureImports([], eventHandlers)
       -> AuditModule.register({ imports: [] })
       -> EventsModule.register({ imports: [], handlers })
  -> providers: DrizzleOutboxProcessor -> TOKENS.OutboxProcessor
  // DRIZZLE_DB / QueueGateway only resolve if parent/sibling/global modules provide them

OutboxProcessorModule.forRootAsync(options, features?)  // Worker path — OK when imports set
  -> connectionImports = options.imports ?? []
  -> buildFeatureImports(connectionImports, eventHandlers)
       -> Audit + Events see Drizzle / queue modules
  -> same OutboxProcessor providers

WorkerModule
  -> OutboxProcessorModule.forRootAsync({
       imports: [InfrastructureConfigModule, drizzleModule, bullMqQueuesModule],
       inject: [AppConfigService],
       useFactory: (config) => config.outbox(),
     }, { eventHandlers: [UserRegisteredEventHandler] })
```

## Goal

Make incomplete Outbox processor registration fail **at module registration time** (or via a required typed `imports` surface) instead of silently building Audit/Events with empty connection imports. Keep the Worker `forRootAsync` path working. Document only the supported registration style(s).

## Scope

- Harden `OutboxProcessorModule.forRoot` so sync registration **requires** non-empty connection imports and forwards them into `buildFeatureImports` (mirror `AuthModule.forRoot(..., { imports })` pattern).
- Add the same non-empty `imports` guard on `forRootAsync` so omitting `imports` cannot silently build the empty graph (consistent with `AuthModule.assertAsyncRegistration`).
- Update unit specs that call sync `forRoot` to pass `MockConnectionModule` (or equivalent) via the new registration `imports` (do not rely on sibling `@Global()` alone to “prove” sync API correctness).
- Add focused unit coverage: empty/missing imports on `forRoot` and `forRootAsync` throw a clear error; happy-path `forRoot` with imports still compiles and exposes tokens.
- Align `docs/infrastructure-modules/README.md` and `EXTRACTION_GUIDE.md` OutboxProcessor wording with the supported API (required imports; prefer Worker `forRootAsync` pattern).
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).

### Recommended approach (A) — default for this plan

Keep both `forRoot` and `forRootAsync`. Change sync signature to require registration imports:

```typescript
type OutboxProcessorRegistrationOptions = {
  imports: NonNullable<ModuleMetadata['imports']>;
  eventHandlers?: Type<IDomainEventHandler>[];
};

static forRoot(
  options: typeof OPTIONS_TYPE = OUTBOX_PROCESSOR_DEFAULT_OPTIONS,
  registration: OutboxProcessorRegistrationOptions,
): DynamicModule
```

- Assert `(registration.imports?.length ?? 0) > 0` (and same for `forRootAsync` options.imports); throw an explicit `Error` naming `OutboxProcessorModule` and instructing to pass Drizzle + queue peer modules (Worker pattern).
- Pass `registration.imports` into `buildFeatureImports` instead of `[]`.
- Do **not** attempt to statically prove `DRIZZLE_DB` / `QueueGateway` presence inside the imports array (length guard + docs, same depth as AuthModule’s Redis imports check).

### Alternate approach (B) — only if human prefers async-only

Deprecate/remove public sync `forRoot`; document and test `forRootAsync` only. Larger breaking surface for any external copy-kit consumers of sync `forRoot`; in-repo impact is still only the module spec. Choose B only if humans want to delete the sync API rather than harden it.

## Out of scope

- Other backlog items (P2-*, P3-08+, P0/P1).
- Changing `DrizzleOutboxProcessor`, Outbox options schema, Cron `OutboxProcessorOptionsModule`, or Worker composition beyond what is required if approach A leaves Worker unchanged.
- Requiring specific module *types* inside `imports` (e.g. detecting `DrizzleModule` by reference) unless humans explicitly expand scope.
- Making `MockConnectionModule` non-global in the spec beyond what is needed to exercise the new `imports` path.
- HTTP endpoints, OpenAPI, or Postman (`docs/postman/`).
- Rewriting `MODULES_OVERVIEW_NON_TECH.md` Outbox narrative (owned by P2-25 if jobId wording) beyond any accidental sync-API claim (none found).

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None (harden existing module + specs + docs).

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts` | `OutboxProcessorModule.forRoot` / `forRootAsync` / `buildFeatureImports`: add registration `imports` on sync API; assert non-empty imports on sync and async; stop hardcoding `[]` in `forRoot`. |
| `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` | Update sync `forRoot` call sites to pass `imports: [MockConnectionModule]`; add throw-on-empty-imports cases for `forRoot` and `forRootAsync`; keep existing async happy paths and handler routing coverage. |
| `docs/infrastructure-modules/README.md` | Registration matrix / any OutboxProcessor notes: sync `forRoot` requires `{ imports, eventHandlers? }`; prefer `forRootAsync` with Worker-style peers. |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md` | § OutboxProcessorModule API row: document required connection imports; keep prefer-`forRootAsync` guidance. |
| `docs/agent-plans/INDEX.md` | Add row for `P3-07` → this plan while `proposed`. |

## Files to delete

- None (unless human selects approach B and explicitly asks to remove `forRoot` — then delete only the sync method and update call sites/docs; still no unrelated deletions).

## Contract and DI changes

- **`libs/contracts`:** none.
- **Public Nest registration API (infrastructure):**
  - Approach A: `OutboxProcessorModule.forRoot` second argument becomes **required** `OutboxProcessorRegistrationOptions` with non-empty `imports` (breaking for any sync caller that omitted imports / used optional `features?` only). `eventHandlers` moves into that object (same fields as today’s features bag + `imports`).
  - `forRootAsync` options shape unchanged (`ConfigurableModuleBuilder` async options already have `imports?`), but empty/omitted `imports` becomes a **runtime throw** at registration.
- **Worker / Cron / API composition:** no required change under approach A (Worker already passes non-empty imports).
- **Tokens:** `TOKENS.OutboxProcessor`, `TOKENS.OutboxProcessorOptions`, Audit/Events tokens unchanged.

## Implementation steps

1. Introduce `OutboxProcessorRegistrationOptions` (`imports` + optional `eventHandlers`) in `outbox-processor.module.ts` (or a colocated types export if needed for clarity — prefer keeping types private/local unless already exported elsewhere).
2. Add private `assertRegistrationImports(imports, methodName)` (or sync/async variants) that throws when `(imports?.length ?? 0) === 0`, with a message telling integrators to pass Drizzle + BullMQ queue modules (cite Worker pattern).
3. Change `forRoot` to require `registration`, call assert, and use `buildFeatureImports(registration.imports, registration.eventHandlers)`.
4. In `forRootAsync`, assert on `options.imports` before `?? []` / buildFeatureImports (Worker path continues to pass).
5. Update `outbox-processor.module.spec.ts`:
   - sync tests: `forRoot(DEFAULT, { imports: [MockConnectionModule], eventHandlers?: [...] })`;
   - optional: stop importing `MockConnectionModule` as a redundant sibling if imports alone suffice (keep LoggerModule as today);
   - new tests: `forRoot` / `forRootAsync` without imports (or `imports: []`) throw matching the assert message.
6. Update `docs/infrastructure-modules/README.md` matrix note and `EXTRACTION_GUIDE.md` OutboxProcessorModule API description.
7. Run targeted then full verification commands below.
8. **Stop** and request plan revision if humans choose approach B after approval of a different signature, or if fixing requires changing Worker composition unexpectedly.

## Migration and rollout concerns

- No database migrations, env vars, or lockfile changes.
- **Breaking for sync `forRoot` callers** that used `forRoot(options)` or `forRoot(options, { eventHandlers })` without `imports`. In-repo: only unit specs. External copy-kit consumers must pass connection modules explicitly.
- `forRootAsync` callers that omitted `imports` will start failing at Nest module definition time — desirable fail-closed behavior; Worker already compliant.
- No production entrypoint registration change expected under approach A.

## Targeted verification

| Command | Purpose |
| --- | --- |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` | Empty-imports guards; sync/async happy paths; handler routing regressions. |
| `npm run build` | Infrastructure + apps compile after `forRoot` signature change. |
| `npm run lint` | No new lint issues on touched files. |

Optional source check after change:

```bash
rg "buildFeatureImports\(\[\]" libs/infrastructure/src/outbox
```

Expect zero matches.

## Full verification

| Command | Purpose |
| --- | --- |
| `npm run build` | Full compile. |
| `npm run lint` | Lint gate. |
| `npm run test:unit` | Fast unit gate including updated outbox module spec. |
| `npm run test:module` | Entrypoint module specs; Worker still boots OutboxProcessor async path. Note: unrelated P2-16 Cron ioredis failures must not expand this plan. |

Do not require `npm run test:int`, live PostgreSQL/Redis, or Postman for AC completion. Bootstrap Worker only if infra is available; missing infra is not a defect.

## Acceptance criteria

- **AC-01:** Sync API cannot silently build a processor graph with empty connection imports — either required typed `imports` and/or registration-time throw (approach A) or sync API removed (approach B if human-selected).
- **AC-02:** Worker `OutboxProcessorModule.forRootAsync` path remains working (existing imports + eventHandlers unchanged).
- **AC-03:** Docs/examples (`docs/infrastructure-modules/README.md`, `EXTRACTION_GUIDE.md`) show only the supported registration style (required connection imports; prefer Worker `forRootAsync`).
- Unit evidence: empty/missing imports throw; non-empty imports compile and expose `TOKENS.OutboxProcessor`.
- No HTTP/OpenAPI/Postman work invented for this issue.

## Risks

- Integrators who depended on sibling/global providers with empty sync `forRoot` must update registrations (intentional).
- Guard checks only import **array length**, not that `DRIZZLE_DB` / queues are actually present — incomplete but non-empty `imports` can still fail later at DI resolve (same class of risk as AuthModule).
- `test:module` may still fail for unrelated P2-16; do not treat as P3-07 scope.
- Approach B (remove `forRoot`) is a larger public API break for copy-kit consumers than approach A.

## Rollback strategy

- Revert the module signature/assert, spec, and docs changes. Worker behavior returns to prior async-only-safe path; sync footgun returns.

## Open questions requiring human decision

1. **Approach A vs B:** Recommended **A** (keep `forRoot`, require non-empty `imports` + async guard). Confirm if humans prefer **B** (remove/deprecate sync `forRoot` entirely).
2. **Sync signature shape:** Recommended second arg `{ imports, eventHandlers? }` (Auth-like). Alternative: three-arg `forRoot(options, { imports }, features?)` — more verbose; only choose if humans want to keep `features` as a separate optional third parameter.
3. **Async empty-imports guard:** Recommended **yes** (include in this fix). Confirm if humans want sync-only hardening and to leave `forRootAsync({ useFactory })` without imports as a silent footgun.
4. **Error vs compile-time:** Nest dynamic modules cannot enforce non-empty `imports` purely at TypeScript call sites without awkward branded types; plan uses runtime throw + required property. Confirm runtime guard is acceptable for AC-01 (recommended).
