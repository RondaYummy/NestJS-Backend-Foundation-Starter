---
issue_id: P2-11
status: approved
owner: human-approval-required
---

# P2-11 — Відновити non-formatting lint gate

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-11 (Medium, Confirmed defect).

Related backlog grouping: **Baseline verification** (lint gate referenced in backlog summary § Lint).

## Investigation notes (2026-06-21)

### 1. Issue still open

Command executed: `npm run lint` → **exit code 1**, exactly **4** `@typescript-eslint/no-unused-vars` errors (no warnings):

| File                                                                | Line | Symbol                                    | Rule                    |
| ------------------------------------------------------------------- | ---- | ----------------------------------------- | ----------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`       | 4    | `computeHandlerTimeoutMs` (import)        | unused import           |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`       | 5    | `computeLockHeartbeatIntervalMs` (import) | unused import           |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`       | 14   | `defaultLockTtlMs`                        | assigned but never used |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts` | 67   | `lockTtlMs`                               | assigned but never used |

Matches backlog evidence. Issue is **not stale**.

### 2. Root cause context (P0-02 partial wiring)

`P0-02-outbox-lease-heartbeat.md` introduced `computeLockHeartbeatIntervalMs`, `computeHandlerTimeoutMs`, and `defaultLockTtlMs` so `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` and env mapping would derive heartbeat/timeout from `lockTtlMs`. Implementation was only partially completed:

- `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` still hardcodes `lockTtlMs: 5 * 60 * 1000`, `heartbeatIntervalMs: 100_000`, `handlerTimeoutMs: 0`.
- `mapOutboxEnvToOptions()` assigns `lockTtlMs` but passes through Zod-parsed env fields directly.
- Imports/constants were left behind, triggering lint.

### 3. Outbox options test already failing

Command executed:

```text
npx jest --config jest.unit.config.ts libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts
```

Result: **1 failed**, 7 passed.

Failing test: `maps computed heartbeat and handler timeout defaults from lock ttl`

- Expected `handlerTimeoutMs`: `300_000` (`computeHandlerTimeoutMs(300_000)`)
- Received: `0` (Zod default `OUTBOX_HANDLER_TIMEOUT_MS: 0`)

This aligns with **current documented behavior** (`README.md` § Outbox tuning: default `handlerTimeoutMs` of `0` disables timeout). The test expectation is stale relative to the schema/README; fixing P2-11 must restore a green test suite.

### 4. Overlap with P2-08 (out of scope for this plan)

`P2-08-outbox-worker-concurrency-single-config-path.md` also lists the same unused symbols in `outbox-processor.defaults.ts` as cleanup during a broader concurrency config-path refactor. **P2-11 does not implement P2-08.** If P2-08 is approved and implemented first, re-run lint before P2-11; overlap may reduce diff size but lint gate restoration remains the acceptance target.

## Current behavior

- `npm run lint` fails with 4 unused-variable errors in two outbox option files.
- CI/local quality gate (`eslint . --max-warnings=0`) is blocked.
- Outbox runtime behavior is unaffected; this is dead-code / incomplete-default wiring debt from P0-02.
- One unit test in `outbox-processor.options.schema.spec.ts` fails due to mismatched handler-timeout expectation.

## Confirmed root cause

After P0-02, helper symbols for derived outbox defaults were added and imported but never wired into `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` or `mapOutboxEnvToOptions()`. An abandoned local `lockTtlMs` in `mapOutboxEnvToOptions()` remains. ESLint `@typescript-eslint/no-unused-vars` (with `varsIgnorePattern: '^_'`) correctly flags these as errors.

## Dependency/runtime flow

```text
outbox-processor.options.schema.ts
  computeLockHeartbeatIntervalMs(lockTtlMs)  --> intended for derived heartbeat default
  computeHandlerTimeoutMs(lockTtlMs)         --> P0-02 proposal; not adopted (default = 0)
  mapOutboxEnvToOptions(env)                 --> maps validated env -> OutboxProcessorOptions
  outboxProcessorEnvSchema                   --> Zod parse + cross-field validation

outbox-processor.defaults.ts
  defaultLockTtlMs                           --> intended DRY source for default lockTtlMs
  OUTBOX_PROCESSOR_DEFAULT_OPTIONS           --> module fallback / forRoot default
  resolveOutboxOptionsFromEnv()              --> Path A env read (P2-08 scope; unchanged here)

Consumers (unchanged by P2-11):
  OutboxProcessorModule.forRoot / forRootAsync
  InfrastructureConfigModule -> mapOutboxEnvToOptions
  DrizzleOutboxProcessor (uses resolved options at runtime)
```

No change to BullMQ worker wiring, env fail-fast path, or outbox processor lease/heartbeat runtime logic.

## Goal

Restore a passing non-formatting lint gate by resolving all four unused-symbol violations without `_`-prefix workarounds, and ensure outbox option unit tests pass with behavior aligned to the current schema and README.

## Scope

1. Fix four ESLint `no-unused-vars` violations in the two files named in the backlog issue.
2. Wire symbols that were clearly intended for use (`defaultLockTtlMs`, `computeLockHeartbeatIntervalMs` in defaults).
3. Remove or stop exporting truly dead symbols (`computeHandlerTimeoutMs`, unused `lockTtlMs` local) with corresponding test updates.
4. Run `npm run lint` and outbox options unit tests.

## Out of scope

- P2-08 duplicate env path / concurrency refactor (`buildOutboxProcessorDecoratorOptions`, `resolveOutboxOptionsFromEnv`, `outboxProcessorEnvSchema` consolidation).
- Changing outbox runtime semantics, env schema fields, or README.
- Optional env-driven recomputation of heartbeat when only `OUTBOX_LOCK_TTL_MS` is set (would require optional Zod fields or transforms — larger than lint restoration).
- Broader lint cleanup elsewhere (lint currently reports only these 4 errors).

## Files to create

None.

## Files to modify

| Path                                                                     | Symbol / responsibility                                                     | Change                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`            | `defaultLockTtlMs`, `OUTBOX_PROCESSOR_DEFAULT_OPTIONS`, imports from schema | Use `defaultLockTtlMs` for `lockTtlMs`; set `heartbeatIntervalMs: computeLockHeartbeatIntervalMs(defaultLockTtlMs)`; remove unused `computeHandlerTimeoutMs` import; keep `handlerTimeoutMs: 0`     |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`      | `lockTtlMs` local, `computeHandlerTimeoutMs`                                | Remove unused `const lockTtlMs` in `mapOutboxEnvToOptions()`; remove `computeHandlerTimeoutMs` export (dead — default timeout is `0`, not `lockTtlMs`)                                              |
| `libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | test `maps computed heartbeat and handler timeout defaults from lock ttl`   | Rename/revise to assert heartbeat matches `computeLockHeartbeatIntervalMs(300_000)` and `handlerTimeoutMs` is `0` when env omits `OUTBOX_HANDLER_TIMEOUT_MS`; drop `computeHandlerTimeoutMs` import |

## Files to delete

None.

## Contract and DI changes

None. `OutboxProcessorOptions` shape and runtime values remain the same:

- `lockTtlMs`: `300_000`
- `heartbeatIntervalMs`: `100_000` (unchanged numerically; now derived via helper)
- `handlerTimeoutMs`: `0`

## Implementation steps

1. **`outbox-processor.defaults.ts`**
   - Remove `computeHandlerTimeoutMs` from import list.
   - Keep `computeLockHeartbeatIntervalMs` import.
   - Set `lockTtlMs: defaultLockTtlMs` in `OUTBOX_PROCESSOR_DEFAULT_OPTIONS`.
   - Set `heartbeatIntervalMs: computeLockHeartbeatIntervalMs(defaultLockTtlMs)`.
   - Leave `handlerTimeoutMs: 0` unchanged.
   - Do not add `_`-prefixed aliases.

2. **`outbox-processor.options.schema.ts`**
   - In `mapOutboxEnvToOptions()`, remove the unused `const lockTtlMs = env.OUTBOX_LOCK_TTL_MS` line; continue mapping `env.OUTBOX_LOCK_TTL_MS` directly to `lockTtlMs`.
   - Delete `computeHandlerTimeoutMs()` function (no production or test consumer after spec update).
   - Retain `computeLockHeartbeatIntervalMs()` (used by defaults and tests).

3. **`outbox-processor.options.schema.spec.ts`**
   - Update the failing test to reflect documented defaults:
     - Heartbeat: still `computeLockHeartbeatIntervalMs(300_000)` → `100_000`.
     - Handler timeout: expect `0`, not `computeHandlerTimeoutMs(300_000)`.
   - Adjust test title to mention heartbeat derivation only (e.g. `maps env defaults with heartbeat derived from lock ttl`).

4. **Verification** (see below).

## Migration and rollout concerns

None. Numeric defaults unchanged; no env var or DB migration.

## Targeted verification

| Command                                                                                                        | Expected result                    |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `npm run lint`                                                                                                 | Exit 0; zero errors, zero warnings |
| `npx jest --config jest.unit.config.ts libs/infrastructure/src/outbox/outbox-processor.options.schema.spec.ts` | All tests pass                     |

## Full verification

| Command                                                            | Expected result | Notes                                                       |
| ------------------------------------------------------------------ | --------------- | ----------------------------------------------------------- |
| `npm run lint`                                                     | Exit 0          | Primary acceptance criterion                                |
| `npm run test:unit -- --testPathPatterns=outbox-processor.options` | Exit 0          | Issue-requested outbox option tests                         |
| `npm run build`                                                    | Exit 0          | Shared infrastructure change; recommended per project rules |

Optional (no outbox processor logic changed): `npm run test:unit` full suite if time permits.

## Acceptance criteria

- [ ] `npm run lint` exits 0 with no errors or warnings.
- [ ] All four backlog-reported unused symbols are resolved without `_`-prefix suppression.
- [ ] `defaultLockTtlMs` and `computeLockHeartbeatIntervalMs` are used in `OUTBOX_PROCESSOR_DEFAULT_OPTIONS` (not deleted while still intended).
- [ ] `computeHandlerTimeoutMs` and unused `lockTtlMs` local are removed (not renamed to `_`).
- [ ] `outbox-processor.options.schema.spec.ts` passes and reflects `handlerTimeoutMs: 0` default.
- [ ] No changes outside the three files listed above unless lint reveals additional failures after fix (report, do not expand scope silently).
- [ ] Outbox runtime option values for default deployment remain: `lockTtlMs=300_000`, `heartbeatIntervalMs=100_000`, `handlerTimeoutMs=0`.

## Risks

| Risk                                                                               | Mitigation                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| P2-08 implemented later touches same files                                         | Re-run lint; merge conflicts likely minor (same symbol cleanup).                      |
| Removing `computeHandlerTimeoutMs` if someone expected `lockTtlMs` default timeout | README and schema already document `0`; P0-02 open question favored disabled default. |
| Accidental numeric default change                                                  | Explicit assertion in updated unit test; values unchanged by design.                  |

## Rollback strategy

Revert the three-file diff. Lint returns to failing state; no runtime or data impact.

## Open questions requiring human decision

1. **`computeHandlerTimeoutMs` removal vs wiring:** Plan removes the function because current schema/README default is `handlerTimeoutMs: 0`. If the team prefers default timeout = `lockTtlMs` instead, revise plan to wire `computeHandlerTimeoutMs` into defaults and Zod mapping (behavior change — not required for lint gate).
2. **Optional heartbeat recomputation in `mapOutboxEnvToOptions`:** When operators set only `OUTBOX_LOCK_TTL_MS`, should heartbeat be recomputed from TTL even if Zod supplies a static default? Out of scope for P2-11; defer unless product requires it (would need optional env fields).
