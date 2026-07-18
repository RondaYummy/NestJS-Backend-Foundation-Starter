# P1-08 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-08-outbox-processor-module-export-options-token.md` (frontmatter `status: approved`, re-checked before editing).

Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`, section **P1-08** — invalid static export of `TOKENS.OutboxProcessorOptions` in `OutboxProcessorModule` causing `UnknownExportException` at module scanning and breaking Worker bootstrap.

## Changed files

| File                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/outbox-processor.module.ts`      | Modified: static `@Module` `exports` reduced to `[TOKENS.OutboxProcessor]`; `forRoot()` and `forRootAsync()` each build a single `optionsModule` constant from `OutboxProcessorOptionsModule.forRoot(...)` / `forRootAsync(...)`, place it in `imports`, and re-export it via dynamic `exports: [optionsModule]`. `buildFeatureImports`, static providers, `global: false`, and the `OUTBOX_PROCESSOR_MODULE_OPTIONS_TOKEN` re-export are unchanged.                                                                                        |
| `libs/infrastructure/src/outbox/outbox-processor.module.spec.ts` | Created: DI regression test under `npm run test:module`. Uses a `MockConnectionModule` exporting stub `DRIZZLE_DB` and `TOKENS.QueueGateway`; compiles `OutboxProcessorModule.forRootAsync({ imports: [MockConnectionModule], useFactory: () => OUTBOX_PROCESSOR_DEFAULT_OPTIONS })`; asserts both `TOKENS.OutboxProcessor` and `TOKENS.OutboxProcessorOptions` resolve at importer scope; uses the same scoped test-env helper pattern as `cron.module.spec.ts` (LoggerModule pulls in `InfrastructureConfigModule`, which validates env). |

No other production files were edited. Pre-existing staged docs changes (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`, the plan file) were left untouched.

## Completed steps

1. Verified plan `status: approved` and revalidated the defect against the current branch (static export present, dynamic methods without `exports`).
2. Wrote the regression test first and ran it against the unfixed module (**red**).
3. Applied the module edit exactly as planned (static export trimmed; one `optionsModule` instance shared between `imports` and `exports` in both factory methods).
4. Re-ran the regression test (**green**), the existing options-module spec, then targeted and full verification.
5. Inspected `git diff` before and after; no unrelated files changed.

## Red → green evidence

- **Red** (before module edit, test file present): `npm run test:module -- outbox-processor.module.spec` → exit 1, both tests failed with:

  ```text
  Nest cannot export a provider/module that is not a part of the currently processed module
  (OutboxProcessorModule). ... Symbol(OutboxProcessorOptions)
      at Module.validateExportedProvider (node_modules/@nestjs/core/injector/module.js:316)
      at DependenciesScanner.reflectExports (node_modules/@nestjs/core/scanner.js:156)
  ```

  This matches the exact failure signature documented in the plan (`UnknownExportException` path).

- **Green** (after module edit, same test unchanged): `npm run test:module -- outbox-processor.module.spec` → exit 0, 2/2 tests passed.

## Deviations

1. **Jest config parse workaround (tooling, pre-existing, no file changed):** on this machine every jest script initially failed to parse its config with `TS5097: An import path can only end with a '.ts' extension...` (in `jest.module.config.ts` / `jest.unit.config.ts`, which import `./jest.config.base.ts`). This is the known pre-existing P2-18 / V-24 backlog defect, confirmed by running the untouched `outbox-processor-options.module.spec` before any code change (same parse failure). Jest runs in this report were executed with the environment variable `TS_NODE_COMPILER_OPTIONS={"allowImportingTsExtensions":true,"noEmit":true}` as a session-only workaround. No jest or tsconfig file was modified; fixing that tooling defect remains P2-18/V-24 scope.
2. **Windows npm wrapper flakiness (transient, retried):** one `npm run build:worker` attempt exited with `-1073741819` and two `npm run build` attempts printed `Unknown command: "C:\nvm4w\nodejs\npm.cmd"`; immediate retries of the identical commands succeeded. This matches the known P2-08/P2-11 Windows npm wrapper behavior documented in `AGENTS.md`, not a code failure.

No deviation from the approved code-change scope.

## Commands executed

| #   | Command                                                                                                        | Result                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `git status` / `git diff` (before implementation)                                                              | Only pre-existing staged docs changes present                                                           |
| 2   | `npm run test:module -- outbox-processor.module.spec` (before fix, no ts-node workaround)                      | Exit 1 — jest config parse failure `TS5097` (pre-existing P2-18/V-24)                                   |
| 3   | `npm run test:module -- outbox-processor-options.module.spec` (before fix, no workaround)                      | Exit 1 — identical `TS5097` parse failure, proving it is pre-existing and unrelated to this change      |
| 4   | `npm run test:module -- outbox-processor.module.spec` (before fix, with `TS_NODE_COMPILER_OPTIONS` workaround) | Exit 1 — 2/2 tests fail with `UnknownExportException` for `Symbol(OutboxProcessorOptions)` (**red**)    |
| 5   | `npm run test:module -- outbox-processor.module.spec` (after fix)                                              | Exit 0 — 2/2 pass (**green**)                                                                           |
| 6   | `npm run test:module -- outbox-processor-options.module.spec` (after fix)                                      | Exit 0 — 1/1 pass                                                                                       |
| 7   | `npm run build:worker`                                                                                         | First attempt exit `-1073741819` (Windows npm wrapper crash); retry exit 0                              |
| 8   | `npm run build:api`                                                                                            | Exit 0                                                                                                  |
| 9   | `npm run build:cron`                                                                                           | Exit 0                                                                                                  |
| 10  | `npm run build:migrations`                                                                                     | Exit 0                                                                                                  |
| 11  | `npm run build`                                                                                                | Two attempts failed with npm wrapper error `Unknown command`; retry exit 0 (all four entrypoints built) |
| 12  | `npm run lint`                                                                                                 | Exit 0 (`eslint . --max-warnings=0`)                                                                    |
| 13  | `npm run test:module` (full)                                                                                   | Exit 0 — 10 suites, 20 tests passed                                                                     |
| 14  | `npm run test:unit` (full)                                                                                     | Exit 0 — 19 suites, 129 tests passed                                                                    |
| 15  | `Test-NetConnection 127.0.0.1 -Port 5432` / `-Port 6379`                                                       | Both `False` — PostgreSQL and Redis not reachable locally                                               |
| 16  | `git status` / `git diff` (before reporting)                                                                   | Diff limited to `outbox-processor.module.ts` + new spec file                                            |

## Command results

Conclusions per command group:

- **Targeted tests (2–6):** regression test demonstrates red→green on the exact `UnknownExportException` root cause; existing options-module spec unaffected.
- **Builds (7–11):** all four entrypoints compile; transient wrapper crashes were retried and are environmental.
- **Lint (12):** clean at zero warnings.
- **Full suites (13–14):** full module/DI suite and full unit suite pass; no regressions.
- **Bootstrap probe (15):** `npm run start:worker` was **not** executed because PostgreSQL (5432) and Redis (6379) are unavailable on this machine — infrastructure unavailability, not a code failure. Module scanning itself (the failing stage for P1-08) is covered by the new regression test, which compiles the real `OutboxProcessorModule.forRootAsync` graph.

## Acceptance criteria self-check

- [x] `OutboxProcessorModule.forRootAsync(...)` and `forRoot(...)` compile without `UnknownExportException` — regression test compiles `forRootAsync` graph successfully; `forRoot` shares the identical export shape.
- [x] `TOKENS.OutboxProcessor` and `TOKENS.OutboxProcessorOptions` both resolve at importer scope — asserted in the regression test (importer-scope `moduleRef.get` for both tokens). Full `WorkerModule` bootstrap itself not executed (infrastructure unavailable, see below).
- [x] Static `@Module` `exports` no longer lists `TOKENS.OutboxProcessorOptions`; options token exposed via re-exported `OutboxProcessorOptionsModule` dynamic-module instance in dynamic `exports`.
- [x] Cron and API composition untouched — no files under `apps/` changed; `cron.module.spec.ts` passes in the full module suite; API/Cron/Migrations builds pass.
- [x] Regression `*.module.spec.ts` exists, fails against unfixed code (`UnknownExportException`), passes after the fix, runs under `npm run test:module`.
- [x] `npm run build`, `npm run build:worker`, `npm run lint` pass (after documented Windows wrapper retries).

## Remaining risks

- The jest `TS5097` config-parse defect (P2-18/V-24) means test scripts require the ts-node compiler-options workaround on environments where jest's config loader picks up strict Node16 resolution; independent verification should reproduce with the same workaround or after P2-18 lands.
- Windows npm wrapper crashes (`-1073741819`, `Unknown command`) remain intermittent on this machine; retries succeed.

## Unverified areas

- Live `npm run start:worker` bootstrap (and end-to-end outbox processing) — PostgreSQL/Redis not available locally; must be confirmed when infrastructure is available. The scan-time failure mode itself is covered by the regression test.
- `npm run test:release`, `npm run test:int` — not in the approved plan's verification matrix; not executed.
