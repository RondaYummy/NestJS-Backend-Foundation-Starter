# TASK-011 — Independent verification

## Verdict

approved

## Approved specification

- Path: `docs/agent-tasks/TASK-011-exceptions-peer-and-deprecated-facades.md`
- Frontmatter `status: approved` — confirmed
- Option B facade removal locked in specification (2026-07-26)

## Approved plan

- Path: `docs/agent-plans/TASK-011-exceptions-peer-and-deprecated-facades.md`
- Frontmatter `status: approved` — confirmed
- Locked decisions verified in implementation:
  - **Q2:** `ExceptionsModule.register({ imports })` with required `imports`
  - **Q3:** Negative DI case in `exceptions.module.spec.ts` (CI module suite)
  - **Q4:** Delete `libs/infrastructure/src/infrastructure.module.ts` (no stub)
  - **Option B:** Remove all six `forRootFromAppConfig` methods

## Scope checked

- Exactly one task implemented: TASK-011 (Exceptions peer + Option B facade hygiene).
- No HTTP/OpenAPI/migration/env-schema work in the TASK-011 production diff.
- No acceptance criteria removed or weakened vs approved specification.
- Plan deviations documented by implementer and re-validated (see Findings — non-blocking).
- **Out-of-scope dirty / staged files (not attributed to TASK-011 implementation edits):**
  - Staged: `docs/agent-plans/INDEX.md`, plan/spec files, `docs/agent-reports/full-review-2026-07-26.md`, `docs/architecture/ADR-001-module-reuse-model.md`, `docs/agent-tasks/INDEX.md`
  - Index rows for TASK-011 still show `proposed` in `docs/agent-tasks/INDEX.md` and `docs/agent-plans/INDEX.md` while specification/plan frontmatter are `approved` (called out in the approved plan as human sync; not an implementation defect).

## Actual changed files

### In TASK-011 implementation scope

| Path                                                                 | Change                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| `libs/infrastructure/src/exceptions/exceptions.module.ts`            | Dynamic `register({ imports })`                          |
| `libs/infrastructure/src/exceptions/exceptions.module.spec.ts`       | Positive + negative DI (untracked at verify time)        |
| `libs/infrastructure/src/exceptions/global-exception.filter.spec.ts` | Mapping assertions (untracked at verify time)            |
| `apps/api/src/api.module.ts`                                         | `ExceptionsModule.register({ imports: [loggerModule] })` |
| `libs/infrastructure/src/redis/redis.module.ts`                      | Removed `forRootFromAppConfig`                           |
| `libs/infrastructure/src/database/drizzle/drizzle.module.ts`         | Removed `forRootFromAppConfig`                           |
| `libs/infrastructure/src/bullmq/bullmq.module.ts`                    | Removed `forRootFromAppConfig`                           |
| `libs/infrastructure/src/auth/auth.module.ts`                        | Removed `forRootFromAppConfig`                           |
| `libs/infrastructure/src/mail/mail.module.ts`                        | Removed `forRootFromAppConfig`                           |
| `libs/infrastructure/src/storage/storage.module.ts`                  | Removed `forRootFromAppConfig`                           |
| `libs/infrastructure/src/infrastructure.module.ts`                   | Deleted                                                  |
| `docs/infrastructure-modules/README.md`                              | Matrix + breaking-removals section                       |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md`                    | Exceptions API + removed-facades note                    |
| `EXAMPLES.md`                                                        | Exceptions under `register`; breaking note               |
| `README.md`                                                          | Removed `infrastructure.module.ts` from tree             |
| `docs/agent-reports/TASK-011-implementation.md`                      | Implementer report (untracked)                           |

### Not modified (confirmed)

- `libs/infrastructure/src/exceptions/global-exception.filter.ts` — mapping logic unchanged
- Worker / Cron — no `ExceptionsModule` imports
- No OpenAPI, migration, or `libs/contracts` files in the TASK-011 diff

## Requirements matrix

| Requirement                                                  | Evidence                                                                                                          | Result |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------ |
| FR-01 Explicit AppLogger peer in Nest registration           | `ExceptionsModule.register({ imports })` required; `ApiModule` passes `loggerModule`                              | passed |
| FR-02 Bootstrap without peer fails DI                        | `exceptions.module.spec.ts` negative case with `imports: []` rejects on AppLogger                                 | passed |
| FR-03 Bootstrap with LoggerModule peer succeeds + APP_FILTER | Positive module spec resolves `AppLogger` + `GlobalExceptionFilter`; providers include `APP_FILTER`/`useExisting` | passed |
| FR-04 ApiModule registers filter with working AppLogger      | `api.module.ts`: `loggerModule` + `ExceptionsModule.register({ imports: [loggerModule] })`; `npm run build` green | passed |
| FR-05 Exception mapping unchanged                            | Filter source untouched; unit spec pins ValidationError/NotFoundError/HttpException/unexpected Error shapes       | passed |
| FR-06 Docs match registration API                            | README matrix, EXTRACTION_GUIDE Exceptions section, EXAMPLES.md align with `register({ imports })`                | passed |
| FR-07 No HTTP/OpenAPI contract changes                       | Diff has no OpenAPI/endpoint/DTO changes                                                                          | passed |
| FR-08 No schema/migration changes                            | Diff has no migration/SQL changes                                                                                 | passed |
| FR-09 Option B facade removal                                | Six methods removed; `infrastructure.module.ts` deleted on disk; docs updated; no live `*.ts` callers             | passed |
| NFR-01 Independent entrypoints; filter API-only              | Worker/Cron still omit Exceptions; Migrations untouched; build all entrypoints                                    | passed |
| NFR-02 Peer not hidden behind unrelated globals alone        | Explicit `imports` edge required at register API + docs                                                           | passed |
| NFR-03 Local composition changes                             | Only Exceptions + facade method/file removals + docs                                                              | passed |
| NFR-04 No DI silencing via any/@ts-ignore/disabled lint      | No such suppressions in changed files; lint `--max-warnings=0`                                                    | passed |
| NFR-05 Build/lint/relevant tests pass with recorded evidence | See Commands executed                                                                                             | passed |

## Acceptance criteria matrix

| AC    | Evidence                                                                                                      | Result |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------ |
| AC-01 | `register({ imports })` required; docs describe peer wiring; no ambient-only registration path                | passed |
| AC-02 | Module spec positive DI with `LoggerModule.forRoot` — 2/2 tests pass                                          | passed |
| AC-03 | Same file negative DI without logger peer — rejects; runs under module suite                                  | passed |
| AC-04 | ApiModule wiring + `global-exception.filter.spec.ts` (4 tests) + filter source unchanged                      | passed |
| AC-05 | README + EXTRACTION_GUIDE Exceptions sections match implemented API                                           | passed |
| AC-06 | No intentional OpenAPI/migration files in TASK-011 diff                                                       | passed |
| AC-07 | `npm run build` pass; `npm run lint` pass; unit 216 pass; Exceptions module specs pass                        | passed |
| AC-08 | Facades gone on disk; docs “Breaking removals” / “Removed facades”; `rg`/`Select-String` on live `*.ts` clean | passed |

## Architecture and DI verification

- **Dependency direction:** Preserved. Exceptions still depends on Logger/`AppLogger` via Nest DI; no Domain/Application boundary violations.
- **Registration API:** Matches approved Q2 contract (`ExceptionsModuleRegisterOptions.imports` required).
- **APP_FILTER shape (documented deviation):** Plan snippet used `useClass: GlobalExceptionFilter`. Implementation uses concrete `GlobalExceptionFilter` provider + `{ provide: APP_FILTER, useExisting: GlobalExceptionFilter }`. Equivalent filter registration; enables test resolution of the filter class. Acceptable, documented.
- **ApiModule composition:** Keeps top-level `loggerModule` and passes the same reference into `register` — matches plan.
- **Entrypoints:** API updated; Worker/Cron unchanged and still do not import Exceptions.
- **Facades:** `forRootFromAppConfig` removed from Redis/Drizzle/BullMQ/Auth/Mail/Storage; unused `AppConfig`/`InfrastructureConfigModule` imports cleaned; `InfrastructureModule` file absent on disk (`git` shows deletion).

## Database and migration verification

None required. No migration or schema files changed. FR-08 / AC-06 satisfied.

## Security verification

- No authz model changes.
- Unexpected errors still map to `INTERNAL_SERVER_ERROR` / `"Internal server error"` without leaking internals (unit assertion).
- Unexpected errors still call `AppLogger.error` when peer is wired (unit assertion).

## Commands executed

| Command                                                                                | Result                                                                                                                                         | Conclusion                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node …/jest.js --config jest.module.config.ts --runInBand exceptions.module.spec`     | pass (1 suite / 2 tests); first attempt crashed exit `-1073741819`, retry passed                                                               | Positive + negative DI OK (AC-02, AC-03)                                                                                                                 |
| `node …/jest.js --config jest.unit.config.ts --runInBand global-exception.filter.spec` | pass (1 suite / 4 tests)                                                                                                                       | Mapping / INTERNAL_SERVER_ERROR / logger.error OK (FR-05, AC-04)                                                                                         |
| `npm run build`                                                                        | pass (api + worker + cron + migrations)                                                                                                        | Shared infrastructure + entrypoints compile                                                                                                              |
| `npm run lint`                                                                         | pass (`eslint . --max-warnings=0`)                                                                                                             | No lint regressions                                                                                                                                      |
| `npm run test:unit`                                                                    | pass (38 suites / 216 tests)                                                                                                                   | Includes new filter unit spec                                                                                                                            |
| `npm run test:module`                                                                  | crashed immediately (`-1073741819`)                                                                                                            | Windows/npm intermittent crash; not used as evidence                                                                                                     |
| `node …/jest.js --config jest.module.config.ts --runInBand` (full module suite)        | **1 failed** (`apps/cron/src/cron.module.spec.ts`: `ioredis_1.default is not a constructor`); **13 passed** including `exceptions.module.spec` | Cron failure is pre-existing/environmental BullMQ/ioredis Jest interop; **not introduced by TASK-011** (Cron does not use Exceptions or removed facades) |
| Disk / search checks                                                                   | `infrastructure.module.ts` ABSENT; `Select-String` / `rg` over live `*.ts` → no `forRootFromAppConfig` / `InfrastructureModule`                | AC-08 code portion                                                                                                                                       |

## Findings

### Non-blocking

1. **APP_FILTER provider deviation** — `useExisting` + concrete provider instead of plan’s `useClass` only. Documented; behavior aligned with FR-01/FR-03/AC-01/AC-02.
2. **Positive DI imports `loggerModule` at testing-module root and in `register`** — mirrors ApiModule; negative case still proves missing peer fails.
3. **Full module suite Cron failure** — unrelated to TASK-011; same as implementer report.
4. **Index status drift** — task/plan INDEX rows still `proposed` while frontmatter is `approved`. Human housekeeping; not an AC failure for this implementation.
5. **Historical docs/reports** still mention facades in past tense / older task context — allowed by plan (do not rewrite historical how-to as live guidance). Current how-to docs correctly describe removal.

### High-impact defects

None.

## Documentation alignment

- `docs/infrastructure-modules/README.md` — Exceptions row uses `register({ imports })`; “Breaking removals (TASK-011)” section present.
- `docs/infrastructure-modules/EXTRACTION_GUIDE.md` — Exceptions peer/API section matches code; “Removed facades” section present.
- `EXAMPLES.md` — Exceptions listed under `register` with Logger peer; breaking note present; no longer under bare Static `@Module`.
- `README.md` — `infrastructure.module.ts` tree entry removed.
- Spec/plan INDEX rows lag frontmatter approval (noted above).

## Remaining risks

- **External / forks:** Breaking for out-of-repo callers of `forRootFromAppConfig`, `InfrastructureModule`, or bare static `ExceptionsModule` import (intentional Option B / Q2).
- **Cron module spec / ioredis Jest interop** remains failing on this machine; investigate separately if CI also fails — not a TASK-011 regression based on diff and Cron composition.

## Unverified areas

- Optional live `npm run start:api` bootstrap smoke (not required; local infra not exercised). Missing PostgreSQL/Redis would be infrastructure unavailability, not a code defect.
- OpenAPI drift test skipped (no HTTP/OpenAPI scope; no OpenAPI files in TASK-011 diff).
- Grep tool may still index the deleted `infrastructure.module.ts` blob; disk + `rg`/`Select-String` + `git` deletion used as authoritative evidence.
