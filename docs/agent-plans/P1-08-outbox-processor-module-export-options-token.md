---
issue_id: P1-08
status: approved
owner: human-approval-required
---

# P1-08 — Fix invalid static export of `TOKENS.OutboxProcessorOptions` in `OutboxProcessorModule`

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — summary table row **P1-08** and full section **P1-08. Виправити невалідний static export `TOKENS.OutboxProcessorOptions` у `OutboxProcessorModule`**.

**Backlog index note:** `docs/agent-backlog/INDEX.md` is absent on this branch (previously staged for deletion in other work). Issue identity is confirmed from `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` (classification: Confirmed defect, severity High).

**Re-validation (2026-07-18, this planning pass):** Defect **still exists**. Production outbox/worker trees have **no local diff**. Staged working-tree changes are docs only (`NESTJS_STARTER_KIT_REQUIRED_FIXES.md` + this plan). Introduced in commit `85eda48` (P2-13).

**Prior plan artifact:** This file previously had `status: approved`. This planning pass **overwrites** it and resets `status: proposed` for fresh human approval. Technical approach is unchanged; verification commands and regression-test guidance are corrected.

## Current behavior

`OutboxProcessorModule` (`libs/infrastructure/src/outbox/outbox-processor.module.ts`) declares in its static `@Module` decorator:

```ts
@Module({
  providers: [
    DrizzleOutboxProcessor,
    { provide: TOKENS.OutboxProcessor, useExisting: DrizzleOutboxProcessor },
  ],
  exports: [TOKENS.OutboxProcessor, TOKENS.OutboxProcessorOptions],
})
export class OutboxProcessorModule { ... }
```

Observed facts in the current branch:

- `TOKENS.OutboxProcessorOptions` is **not** in this module’s own `providers`.
- It is provided/exported by `OutboxProcessorOptionsModule` (`libs/infrastructure/src/outbox/outbox-processor-options.module.ts`), which is added only via the dynamic `imports` arrays of `forRoot()` / `forRootAsync()`.
- Those dynamic methods currently return **no** `exports` array — they do not re-export the options module.
- `WorkerModule` (`apps/worker/src/worker.module.ts`) is the only production entrypoint importing `OutboxProcessorModule.forRootAsync(...)`.
- `outboxProcessorProvider` (`apps/worker/src/processors/outbox-processor.provider.ts`) injects both `TOKENS.OutboxProcessorOptions` and `TOKENS.OutboxProcessor`.
- Cron uses `OutboxProcessorOptionsModule.forRootAsync(...)` directly (`apps/cron/src/cron.module.ts`); API does not import either module.
- Deprecated `InfrastructureModule` (`libs/infrastructure/src/infrastructure.module.ts`) also composes `OutboxProcessorModule.forRootAsync(...)`.

## Confirmed root cause

Nest merges static `@Module` decorator metadata with dynamic-module metadata from `forRoot*`. During scanning, `DependenciesScanner.reflectExports` → `Module.validateExportedProvider` validates every export in the scope of `OutboxProcessorModule` itself.

Installed `@nestjs/core@11.1.27` (`validateExportedProvider` in `node_modules/@nestjs/core/injector/module.js`) allows an export only when the token is either:

1. present in the module’s own `providers`, or
2. a **module class** listed in the module’s `imports` (module re-export; a `DynamicModule` export is reduced to its `module` class ref before validation).

A symbol token provided only by an imported module (`OutboxProcessorOptionsModule`) satisfies neither condition, so Nest throws:

```text
UnknownExportException: Nest cannot export a provider/module that is not a part of the
currently processed module (OutboxProcessorModule) ... Symbol(OutboxProcessorOptions)
    at Module.validateExportedProvider (@nestjs/core/injector/module.js:316)
    at DependenciesScanner.reflectExports (@nestjs/core/scanner.js:156)
```

This is a confirmed DI/bootstrap defect, not an infrastructure-availability issue: it fails at module-scanning before PostgreSQL/Redis connections are attempted. `tsc` / `nest build` do not catch it; there is no `worker.module.spec.ts` covering Worker bootstrap.

## Dependency/runtime flow

### Current (broken)

```text
WorkerModule
  └─ OutboxProcessorModule.forRootAsync(...)
       imports: [
         OutboxProcessorOptionsModule.forRootAsync(...)  → provides/exports TOKENS.OutboxProcessorOptions
         AuditModule, EventsModule, LoggerModule, connectionImports
       ]
       dynamic exports: (none)
       @Module.exports (static): [ TOKENS.OutboxProcessor, TOKENS.OutboxProcessorOptions ]
                                                            └── not own provider, not a module class in imports
                                                                → validateExportedProvider → UnknownExportException
```

### Target

```text
WorkerModule
  └─ OutboxProcessorModule.forRootAsync(...)
       imports: [ optionsModule (= OutboxProcessorOptionsModule.forRootAsync(...)), ...features ]
       exports: [ optionsModule ]                       ← re-export module class → re-exports options token
       @Module.exports (static): [ TOKENS.OutboxProcessor ]  ← own provider only

outboxProcessorProvider (WorkerModule provider)
  inject: [ TOKENS.OutboxProcessorOptions (via re-exported optionsModule), TOKENS.OutboxProcessor ]
```

## Goal

Make `OutboxProcessorModule` bootstrap successfully while keeping both `TOKENS.OutboxProcessor` and `TOKENS.OutboxProcessorOptions` visible to importers (Worker), without changing public module method signatures, token identities, or Cron/API composition.

## Scope

1. Remove `TOKENS.OutboxProcessorOptions` from the static `@Module` `exports` of `OutboxProcessorModule` (keep `TOKENS.OutboxProcessor`).
2. In `forRoot()` / `forRootAsync()`, capture a single `OutboxProcessorOptionsModule` dynamic-module instance and place that same instance in both `imports` and `exports` of the returned `DynamicModule`.
3. Add a regression `*.module.spec.ts` that fails on current code with `UnknownExportException` and, after the fix, resolves both tokens.

## Out of scope

- Any change to `OutboxProcessorOptionsModule` public API, `forRoot` / `forRootAsync` signatures, or exported aliases.
- Any change to `TOKENS.OutboxProcessorOptions`, `TOKENS.OutboxProcessor`, or the `OutboxProcessorOptions` contract shape.
- Cron (`apps/cron`), API, and Migrations composition roots.
- Worker processor logic, BullMQ concurrency, outbox retry/lease behavior.
- `InfrastructureModule` deprecated facade beyond benefiting passively from the fix.
- Restoring `docs/agent-backlog/INDEX.md`.
- Unrelated staged backlog doc edits outside this plan file.

## Files to create

| File                                                             | Symbol / responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` | Nest DI regression under `npm run test:module` (jest matches `**/*.module.spec.ts`; unit config **ignores** `*.module.spec.ts`). Compile `OutboxProcessorModule.forRoot(...)` or `forRootAsync(...)` with a thin mock connection module supplying `DRIZZLE_DB` + `TOKENS.QueueGateway` (needed by `AuditLogger` / `UserRegisteredEventHandler`). Assert both `TOKENS.OutboxProcessor` and `TOKENS.OutboxProcessorOptions` resolve; optionally assert a consumer-module probe that injects both. Must fail on current code with `UnknownExportException`. |

## Files to modify

| File                                                        | Symbol / change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts` | (a) Change static `@Module` `exports` from `[TOKENS.OutboxProcessor, TOKENS.OutboxProcessorOptions]` to `[TOKENS.OutboxProcessor]`. (b) In `forRoot` and `forRootAsync`, assign one `optionsModule` constant from `OutboxProcessorOptionsModule.forRoot(...)` / `forRootAsync(...)`, put it in `imports`, and add `exports: [optionsModule]` on the returned `DynamicModule`. Keep `buildFeatureImports`, static providers, `global: false`, and the `OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN` re-export unchanged. |

## Files to delete

None.

## Contract and DI changes

| Item                                                             | Change                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `TOKENS.OutboxProcessorOptions` (`libs/contracts/src/tokens.ts`) | **No change**                                                                                                      |
| `TOKENS.OutboxProcessor`                                         | **No change** — remains an own provider of `OutboxProcessorModule`                                                 |
| `OutboxProcessorModule.forRoot` / `forRootAsync` signatures      | **No change** — only returned dynamic `exports` metadata changes                                                   |
| Effective tokens visible to importers                            | **Unchanged surface**: both tokens remain visible to `WorkerModule` (options token via re-exported options module) |
| `OutboxProcessorOptionsModule`                                   | **No change**                                                                                                      |

### Consumers of affected contracts

| Consumer                                   | Current                                                                     | After fix                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| `outboxProcessorProvider` (Worker)         | Injects both tokens from imported `OutboxProcessorModule`                   | Same tokens; options token via re-exported options module |
| `DrizzleOutboxProcessor`                   | Injects `TOKENS.OutboxProcessorOptions` (options module already in imports) | Unchanged                                                 |
| `WorkerModule`                             | `OutboxProcessorModule.forRootAsync(...)`                                   | **Unchanged import**                                      |
| `CronModule`                               | `OutboxProcessorOptionsModule.forRootAsync(...)`                            | **Unchanged**                                             |
| `InfrastructureModule` (deprecated facade) | `OutboxProcessorModule.forRootAsync(...)`                                   | **Unchanged import** (benefits from fix)                  |

## Implementation steps

1. **Edit static decorator** in `outbox-processor.module.ts`:
   - Set `exports: [TOKENS.OutboxProcessor]` (drop `TOKENS.OutboxProcessorOptions`).
2. **Refactor `forRoot`**:
   ```ts
   const optionsModule = OutboxProcessorOptionsModule.forRoot(options);
   return {
     module: OutboxProcessorModule,
     global: false,
     imports: [optionsModule, ...OutboxProcessorModule.buildFeatureImports()],
     exports: [optionsModule],
   };
   ```
3. **Refactor `forRootAsync`** symmetrically:
   ```ts
   const connectionImports = options.imports ?? [];
   const optionsModule = OutboxProcessorOptionsModule.forRootAsync(options);
   return {
     module: OutboxProcessorModule,
     global: false,
     imports: [optionsModule, ...OutboxProcessorModule.buildFeatureImports(connectionImports)],
     exports: [optionsModule],
   };
   ```
4. **Add regression test** `outbox-processor.module.spec.ts`:
   - Follow patterns from `outbox-processor-options.module.spec.ts` / `auth.module.spec.ts`.
   - Use one shared mock connection module exporting stub `DRIZZLE_DB` and `TOKENS.QueueGateway`.
   - Compile `OutboxProcessorModule.forRootAsync({ imports: [MockConnectionModule], useFactory: () => OUTBOX_PROCESSOR_DEFAULT_OPTIONS })` (or equivalent `forRoot` + connection imports if implementer prefers).
   - Assert `moduleRef.get(TOKENS.OutboxProcessor)` and `moduleRef.get(TOKENS.OutboxProcessorOptions)` succeed; close the module.
   - Confirm the test fails against unfixed code with `UnknownExportException` before applying the module edit (or via a brief red→green check during implementation).
5. **Do not edit** `apps/worker/src/worker.module.ts` or `outbox-processor.provider.ts` — visibility must come from the fixed module exports alone.

## Migration and rollout concerns

- No schema migration, no persistent state change.
- Pure DI-metadata fix; Worker, Cron, and API can deploy independently.
- After the fix, Worker boots past module scanning; runtime still requires PostgreSQL/Redis/BullMQ to process outbox rows (unchanged).

## Targeted verification

| Command                                                       | Purpose                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run build:worker`                                        | Worker entrypoint compiles                                                                   |
| `npm run test:module -- outbox-processor.module.spec`         | New regression DI test passes (**not** `test:unit` — unit config ignores `*.module.spec.ts`) |
| `npm run test:module -- outbox-processor-options.module.spec` | Existing options-module DI test still passes                                                 |

## Full verification

| Command                                     | Purpose                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run build`                             | Full multi-entrypoint build                                                                               |
| `npm run lint`                              | Lint gate                                                                                                 |
| `npm run test:module`                       | Full module/bootstrap DI suite                                                                            |
| `npm run test:unit`                         | Fast unit suite (sanity; no new unit files expected)                                                      |
| `npm run start:worker` (or Docker `worker`) | Bootstrap Worker with Redis/PostgreSQL/BullMQ available; confirm no `UnknownExportException` at scan time |

## Acceptance criteria

- [ ] `OutboxProcessorModule.forRootAsync(...)` and `forRoot(...)` compile without `UnknownExportException`.
- [ ] Worker bootstrap passes module scanning; `TOKENS.OutboxProcessor` and `TOKENS.OutboxProcessorOptions` both resolve inside `WorkerModule`.
- [ ] Static `@Module` `exports` no longer lists `TOKENS.OutboxProcessorOptions`; options token is exposed via re-exported `OutboxProcessorOptionsModule` instance in dynamic `exports`.
- [ ] Cron and API composition are untouched and still boot.
- [ ] A `*.module.spec.ts` regression test exists that fails against the current code and passes after the fix; it runs under `npm run test:module`.
- [ ] `npm run build`, `npm run build:worker`, and `npm run lint` pass.

## Risks

| Risk                                                                                      | Mitigation                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-exporting the dynamic options module does not surface the token to importers           | Regression test asserts `TOKENS.OutboxProcessorOptions` resolves at importing-module scope                                                   |
| Duplicate options-module instantiation if `imports` and `exports` use different instances | Build one `optionsModule` constant and reference it in both arrays                                                                           |
| Full graph needs Drizzle/Queue stubs for the module spec                                  | Use a mock connection module exporting `DRIZZLE_DB` + `TOKENS.QueueGateway` via `forRootAsync` `imports`                                     |
| Hidden consumer relying on the old static export shape                                    | Consumers searched: Worker `outboxProcessorProvider`, `DrizzleOutboxProcessor`, deprecated `InfrastructureModule`; all keep token visibility |

## Rollback strategy

Revert the commit. Behavior returns to the current broken state (Worker fails to bootstrap). No data migration or persistent state; safe to roll back independently.

## Open questions requiring human decision

1. **P0 escalation (optional):** Filed as **P1-08 / High** while Worker entrypoint is fully down at bootstrap. Escalate to P0, or keep P1 for this fix?
2. No other blocking decisions — recommended regression-test placement (`libs/infrastructure/.../outbox-processor.module.spec.ts` under `test:module`) and fix shape (drop static symbol export + re-export one `optionsModule` instance) are fixed by this plan.
