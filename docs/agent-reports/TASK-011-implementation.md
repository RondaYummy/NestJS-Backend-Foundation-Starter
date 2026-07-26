# TASK-011 — Implementation report

## Verdict

implemented

## Approved specification

- Path: `docs/agent-tasks/TASK-011-exceptions-peer-and-deprecated-facades.md`
- Frontmatter `status: approved`

## Approved plan

- Path: `docs/agent-plans/TASK-011-exceptions-peer-and-deprecated-facades.md`
- Frontmatter `status: approved`
- Locked decisions: Q2 `ExceptionsModule.register({ imports })`; Q3 negative DI in CI; Q4 delete `InfrastructureModule` (no stub); Option B facade removal

## Changed files

Production / docs (this task):

- `libs/infrastructure/src/exceptions/exceptions.module.ts` (modified)
- `libs/infrastructure/src/exceptions/exceptions.module.spec.ts` (created)
- `libs/infrastructure/src/exceptions/global-exception.filter.spec.ts` (created)
- `apps/api/src/api.module.ts` (modified)
- `libs/infrastructure/src/redis/redis.module.ts` (modified)
- `libs/infrastructure/src/database/drizzle/drizzle.module.ts` (modified)
- `libs/infrastructure/src/bullmq/bullmq.module.ts` (modified)
- `libs/infrastructure/src/auth/auth.module.ts` (modified)
- `libs/infrastructure/src/mail/mail.module.ts` (modified)
- `libs/infrastructure/src/storage/storage.module.ts` (modified)
- `libs/infrastructure/src/infrastructure.module.ts` (deleted)
- `docs/infrastructure-modules/README.md` (modified)
- `docs/infrastructure-modules/EXTRACTION_GUIDE.md` (modified)
- `EXAMPLES.md` (modified)
- `README.md` (modified)

Pre-existing staged docs (not produced by this implementation; left untouched):

- `docs/agent-plans/INDEX.md`, `docs/agent-plans/TASK-011-exceptions-peer-and-deprecated-facades.md`
- `docs/agent-tasks/INDEX.md`, `docs/agent-tasks/TASK-011-exceptions-peer-and-deprecated-facades.md`
- `docs/agent-reports/full-review-2026-07-26.md`
- `docs/architecture/ADR-001-module-reuse-model.md`

## Completed phases

1. **Phase 1 — ExceptionsModule `register({ imports })`** — dynamic module with required `imports`; `ApiModule` uses `ExceptionsModule.register({ imports: [loggerModule] })`.
2. **Phase 2 — DI + filter behavior specs** — positive/negative module DI; filter unit mapping for ValidationError, NotFoundError, HttpException, unexpected Error.
3. **Phase 3 — Remove deprecated facades** — removed six `forRootFromAppConfig` methods; deleted `infrastructure.module.ts`; cleaned unused AppConfig imports. `rg` over `*.ts` → zero hits.
4. **Phase 4 — Documentation alignment** — infrastructure README, EXTRACTION_GUIDE, EXAMPLES.md, README tree updated. Plan INDEX already listed TASK-011.
5. **Phase 5 — Full verification + report** — build/lint/unit/module evidence recorded below.

## Acceptance criteria self-check

| AC    | Result | Evidence                                                                     |
| ----- | ------ | ---------------------------------------------------------------------------- |
| AC-01 | met    | `ExceptionsModule.register({ imports })` required; docs describe peer wiring |
| AC-02 | met    | `exceptions.module.spec.ts` positive case with `LoggerModule.forRoot`        |
| AC-03 | met    | Same file negative case with `imports: []` rejects on `AppLogger`            |
| AC-04 | met    | ApiModule wiring + `global-exception.filter.spec.ts` mapping assertions      |
| AC-05 | met    | README + EXTRACTION_GUIDE Exceptions sections match `register({ imports })`  |
| AC-06 | met    | No OpenAPI/migration files in diff                                           |
| AC-07 | met    | `npm run build` pass; `npm run lint` pass; unit + TASK-011 module specs pass |
| AC-08 | met    | Facades gone; docs updated; `*.ts` search clean                              |

## Contract and DI changes

- No `libs/contracts` token changes.
- Nest registration: `ExceptionsModule` is dynamic `register` only (breaking for bare static import).
- Providers: `GlobalExceptionFilter` + `{ provide: APP_FILTER, useExisting: GlobalExceptionFilter }` (see Deviations).
- Breaking removal of `forRootFromAppConfig` and `InfrastructureModule`.

## Database and migration changes

None.

## Commands executed

1. `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand exceptions.module.spec`
2. `npm run test:unit -- global-exception.filter.spec` / equivalent jest path filter
3. `npm run build`
4. `npm run lint`
5. `node node_modules/jest/bin/jest.js --config jest.unit.config.ts --runInBand`
6. `node node_modules/jest/bin/jest.js --config jest.module.config.ts --runInBand` (full suite)
7. Targeted module specs for Exceptions + facade modules
8. `rg` / Grep `forRootFromAppConfig` and `InfrastructureModule` over `*.ts`

## Command results

| Command                                                                           | Result                                                                                     | Conclusion                                                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `exceptions.module.spec`                                                          | pass (2 tests)                                                                             | Positive + negative DI OK                                                                                                                    |
| `global-exception.filter.spec`                                                    | pass (4 tests)                                                                             | Mapping / INTERNAL_SERVER_ERROR / logger.error OK                                                                                            |
| `npm run build`                                                                   | pass                                                                                       | Shared infrastructure + all entrypoints compile                                                                                              |
| `npm run lint`                                                                    | pass (after type-import fix in filter spec)                                                | No lint regressions                                                                                                                          |
| `test:unit --runInBand`                                                           | pass (38 suites / 216 tests)                                                               | Includes new filter unit spec                                                                                                                |
| Full `test:module`                                                                | **1 fail** (`apps/cron/src/cron.module.spec.ts`: `ioredis_1.default is not a constructor`) | Unrelated to TASK-011; Cron does not use Exceptions or removed facades. All other 13 module suites passed including `exceptions.module.spec` |
| Facade-related module specs (auth/redis/mail/storage/drizzle/bullmq + exceptions) | pass                                                                                       | Facade removals did not break module DI specs                                                                                                |
| `*.ts` search for `forRootFromAppConfig` / `InfrastructureModule`                 | zero hits                                                                                  | AC-08 code portion                                                                                                                           |

## Deviations

1. **`APP_FILTER` provider shape:** Plan snippet used `{ provide: APP_FILTER, useClass: GlobalExceptionFilter }`. Implementation uses `GlobalExceptionFilter` as a concrete provider plus `{ provide: APP_FILTER, useExisting: GlobalExceptionFilter }`. Same runtime filter registration; enables resolving `GlobalExceptionFilter` in the Nest testing module (Nest does not expose enhancer tokens via `moduleRef.get(APP_FILTER)`). Behavior and peer `imports` contract unchanged.
2. **Positive DI test imports `loggerModule` at testing-module root and in `register`:** Mirrors `ApiModule` composition (global logger + explicit peer edge). Still proves missing-peer failure when `imports: []`.
3. **Full `npm run test:module`:** One pre-existing/environmental Cron suite failure (`ioredis` default export under Jest). Not introduced by this diff; not fixed here (out of scope).

## Documentation changes

- `docs/infrastructure-modules/README.md` — Exceptions `register`; removed deprecated facade matrix rows; “Breaking removals (TASK-011)” section.
- `docs/infrastructure-modules/EXTRACTION_GUIDE.md` — taxonomy, per-module API notes, Exceptions section, removed InfrastructureModule how-to.
- `EXAMPLES.md` — Exceptions moved to `register({ imports })`; breaking-removal note.
- `README.md` — removed `infrastructure.module.ts` from tree.
- Historical agent-reports / older task plans left as past-tense mentions (per plan).

## Remaining risks

- **External / forks:** Breaking for any out-of-repo callers of `forRootFromAppConfig`, `InfrastructureModule`, or bare `ExceptionsModule` static import.
- **Cron module spec failure** remains on this machine; investigate separately if CI also fails (ioredis/BullMQ Jest interop).

## Unverified areas

- Live `npm run start:api` bootstrap smoke (optional; local infra not exercised).
- OpenAPI drift test skipped (no HTTP/OpenAPI scope; no OpenAPI files in diff).
- Independent verification agent not run (implementer must not self-approve).
