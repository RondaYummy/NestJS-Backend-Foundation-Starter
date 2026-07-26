---
task_id: TASK-011
specification: docs/agent-tasks/TASK-011-exceptions-peer-and-deprecated-facades.md
status: approved
owner: human-approval-required
---

# TASK-011 — Implementation plan

## Approved specification

- Specification: `docs/agent-tasks/TASK-011-exceptions-peer-and-deprecated-facades.md`
  (frontmatter `status: approved`).
- Intent:
  1. Make `ExceptionsModule`’s `AppLogger` / `LoggerModule` peer **explicit** in Nest
     registration (portability / composition hygiene).
  2. Apply human-chosen **Option B**: remove deprecated `forRootFromAppConfig` on
     Redis / Drizzle / BullMQ / Auth / Mail / Storage, and remove
     `InfrastructureModule.forRoot` (delete-vs-stub = Q4).
- No HTTP/OpenAPI contract changes. No migrations.
- Source of truth: FR-01..FR-09, NFR-01..NFR-05, AC-01..AC-08.
- **Index note:** `docs/agent-tasks/INDEX.md` still lists TASK-011 as `proposed`
  while the specification frontmatter is `approved`. Treat frontmatter as
  authoritative for this plan; human should sync the index row when convenient
  (out of implementer scope unless asked).

## Current implementation

Revalidated on the current branch (`git status`: staged/untracked docs for
full-review, TASK-011, ADR-001, INDEX; no production-code edits in flight for
this task).

### Exceptions / Logger

- `libs/infrastructure/src/exceptions/exceptions.module.ts` — static `@Module`
  providing `{ provide: APP_FILTER, useClass: GlobalExceptionFilter }` only; no
  `imports`, no `register`.
- `libs/infrastructure/src/exceptions/global-exception.filter.ts` —
  `constructor(private readonly logger: AppLogger)`; maps domain / HTTP /
  unexpected errors to `{ success: false, error: { code, message, details } }`.
  No dedicated unit/module spec today.
- `libs/infrastructure/src/logger/logger.module.ts` — `forRoot` / `forRootAsync`
  with `global: true`; exports `AppLogger`. Empty `@Module({})` shell without
  options does **not** provide `AppLogger`.
- `apps/api/src/api.module.ts` — builds `loggerModule = LoggerModule.forRootAsync(...)`,
  then `imports: [loggerModule, ExceptionsModule, ...]`. Filter DI succeeds only
  because `LoggerModule` is global and registered in the same root — not via an
  explicit Exceptions → Logger module edge.
- Worker / Cron import `LoggerModule`; they do **not** import `ExceptionsModule`
  (HTTP-only; keep that way).

### Deprecated facades

- `forRootFromAppConfig` definitions only (no `*.ts` callers outside definitions):
  - `libs/infrastructure/src/redis/redis.module.ts`
  - `libs/infrastructure/src/database/drizzle/drizzle.module.ts`
  - `libs/infrastructure/src/bullmq/bullmq.module.ts`
  - `libs/infrastructure/src/auth/auth.module.ts`
  - `libs/infrastructure/src/mail/mail.module.ts`
  - `libs/infrastructure/src/storage/storage.module.ts`
- `libs/infrastructure/src/infrastructure.module.ts` — `@deprecated`
  `InfrastructureModule.forRoot()` full-stack facade + sample
  `UserRegisteredEventHandler`. Not exported from a barrel `index.ts`. Listed in
  `README.md` tree and infrastructure docs.
- Real composition roots already use explicit `forRootAsync` / `register*` +
  `mapAppConfigTo*`.

### Docs / examples to realign

- `docs/infrastructure-modules/README.md` — matrix rows for Exceptions + deprecated
  facades; “Deprecated facade” section.
- `docs/infrastructure-modules/EXTRACTION_GUIDE.md` — registration taxonomy,
  per-module `forRootFromAppConfig` notes, Exceptions + InfrastructureModule
  sections.
- `EXAMPLES.md` — lists `ExceptionsModule` under “Static `@Module`”.
- `README.md` — tree entry `infrastructure.module.ts`.

### Existing peer pattern to reuse

- `IdempotencyModule.register({ imports })` /
  `RateLimiterModule.register({ imports, ... })` — dynamic module, peer modules
  passed via `imports`.
- Module DI specs: `logger.module.spec.ts`, `events.module.spec.ts`, etc. under
  `*.module.spec.ts` (run via `npm run test:module`).

## Architecture decision

### Q2 (proposed) — Exceptions peer API shape

**Prefer `ExceptionsModule.register({ imports })`**, aligned with Idempotency /
RateLimiter and `.cursor/rules/20-module-portability.mdc`.

Reject static `@Module({ imports: [LoggerModule] })`: `LoggerModule` without
`forRoot` / `forRootAsync` does not register `AppLogger`, so a bare class import
cannot express the peer correctly.

Contract:

```typescript
type ExceptionsModuleRegisterOptions = {
  /** Must include a configured `LoggerModule.forRoot` / `forRootAsync` (or equivalent that exports `AppLogger`). */
  imports: NonNullable<ModuleMetadata['imports']>;
};

@Module({})
export class ExceptionsModule {
  static register(options: ExceptionsModuleRegisterOptions): DynamicModule {
    return {
      module: ExceptionsModule,
      imports: options.imports,
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    };
  }
}
```

- `imports` is **required** at the TypeScript API (no silent empty default).
- Nest DI still enforces `AppLogger` at compile time (FR-02 / AC-03).
- Do **not** hard-import `LoggerModule` inside Exceptions; caller supplies the
  already-configured dynamic module (same instance as the composition-root
  `loggerModule` variable is fine and preferred).

API composition after change:

```typescript
imports: [
  loggerModule,
  ExceptionsModule.register({ imports: [loggerModule] }),
  // ...
];
```

Keep top-level `loggerModule` so middleware / other consumers continue to see
the global logger; pass the same reference into `register` for an explicit edge.

### Q3 (proposed) — Negative DI test in CI

**Require a CI module spec** (`exceptions.module.spec.ts`) that asserts
`Test.createTestingModule({ imports: [ExceptionsModule.register({ imports: [] })] }).compile()`
**rejects** (Nest cannot resolve `AppLogger`). Documented-only / manual check is
insufficient for AC-03.

Also require a **positive** case with `LoggerModule.forRoot({...})` in `imports`
that compiles and resolves `APP_FILTER` as `GlobalExceptionFilter`.

### Q4 (proposed) — `InfrastructureModule` disposition

**Delete** `libs/infrastructure/src/infrastructure.module.ts` entirely. Do **not**
leave a throw stub (still a copy-paste attractor). Update docs/tree references so
nothing claims the facade still exists. External forks that still call it get a
clear compile break (consistent with Option B).

Binding: these Q2–Q4 answers become mandatory when a human sets this plan’s
`status: approved`. If the human rejects any proposed answer, revise the plan
before implementation.

## Scope

- Convert `ExceptionsModule` to `register({ imports })`; update `ApiModule`.
- Add `exceptions.module.spec.ts` (positive + negative DI) and lightweight
  filter mapping assertions for FR-05 / AC-04 (new
  `global-exception.filter.spec.ts` or equivalent unit cases).
- Remove all six `forRootFromAppConfig` methods; delete `infrastructure.module.ts`.
- Clean unused imports left behind in those module files after method removal.
- Update infrastructure README, EXTRACTION_GUIDE, EXAMPLES.md, README tree, and
  any remaining “how to use facade” guidance so AC-08 holds under repo search.
- Record build / lint / test commands in the implementation report.

## Out of scope

- Exception → HTTP mapping rule changes; replacing `AppLogger` with Nest `Logger`.
- Pulling `ExceptionsModule` into Worker / Cron.
- Rate-limiter `req.ip` / trust-proxy Low finding.
- Broader `InfrastructureConfigModule` global redesign; npm packaging.
- OpenAPI / HTTP endpoint / migration / env-schema work.
- Switching facade disposition away from Option B.
- Approving this plan or implementing without human plan approval.

## Files to create

| Path                                                                 | Responsibility                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/exceptions/exceptions.module.spec.ts`       | Positive + negative Nest DI for `ExceptionsModule.register` (AC-02, AC-03)                                                |
| `libs/infrastructure/src/exceptions/global-exception.filter.spec.ts` | Focused mapping assertions for representative domain/HTTP/unexpected errors (FR-05, AC-04) — no Nest HTTP server required |

## Files to modify

| Path                                                         | Change                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/exceptions/exceptions.module.ts`    | Replace static `@Module` APP_FILTER registration with `register({ imports })` DynamicModule |
| `apps/api/src/api.module.ts`                                 | `ExceptionsModule.register({ imports: [loggerModule] })`                                    |
| `libs/infrastructure/src/redis/redis.module.ts`              | Remove `forRootFromAppConfig` (+ unused AppConfig imports if any)                           |
| `libs/infrastructure/src/database/drizzle/drizzle.module.ts` | Same                                                                                        |
| `libs/infrastructure/src/bullmq/bullmq.module.ts`            | Same                                                                                        |
| `libs/infrastructure/src/auth/auth.module.ts`                | Same                                                                                        |
| `libs/infrastructure/src/mail/mail.module.ts`                | Same                                                                                        |
| `libs/infrastructure/src/storage/storage.module.ts`          | Same                                                                                        |
| `docs/infrastructure-modules/README.md`                      | Matrix + Deprecated facade section → Exceptions `register`; remove facade rows / guidance   |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md`            | Taxonomy, per-module notes, Exceptions + InfrastructureModule sections                      |
| `EXAMPLES.md`                                                | Move Exceptions from “Static `@Module`” to `register({ imports })` example note             |
| `README.md`                                                  | Remove `infrastructure.module.ts` from tree (or note removal)                               |
| `docs/agent-plans/INDEX.md`                                  | Add TASK-011 plan row (`proposed`)                                                          |

## Files to delete

| Path                                               | Reason                         |
| -------------------------------------------------- | ------------------------------ |
| `libs/infrastructure/src/infrastructure.module.ts` | Option B + Q4 delete — no stub |

## Domain changes

None.

## Application changes

None.

## Contract and DI changes

- No `libs/contracts` token changes.
- Nest public registration: `ExceptionsModule` becomes dynamic `register` only
  (intentional break for bare static import without peer).
- Breaking removal of `forRootFromAppConfig` and `InfrastructureModule` (Option B).

## Infrastructure changes

- Exceptions peer wiring as above.
- Facade method / file removals as above.
- Do not change `GlobalExceptionFilter` mapping logic except if a test-only
  export is unnecessary — prefer testing the class as-is.

## Interface and entrypoint changes

| Entrypoint | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| API        | Update Exceptions registration (FR-04).                                |
| Worker     | None expected (confirm no hidden `ExceptionsModule` / facade imports). |
| Cron       | None expected.                                                         |
| Migrations | None.                                                                  |

## Database and migration changes

None (FR-08 / AC-06).

## Security and authorization changes

None. Preserve non-leak of unexpected error internals (`INTERNAL_SERVER_ERROR`
message) via filter unit assertions.

## Observability changes

Unexpected errors continue to call `AppLogger.error` when the peer is wired
(assert in filter unit test with a mock logger).

## Implementation phases

### Phase 1 — ExceptionsModule `register({ imports })`

- Paths: `libs/infrastructure/src/exceptions/exceptions.module.ts`,
  `apps/api/src/api.module.ts`
- Symbols: `ExceptionsModule.register`, `ExceptionsModuleRegisterOptions`,
  `APP_FILTER` → `GlobalExceptionFilter`; ApiModule imports update.
- AC: AC-01, AC-04 (composition wiring portion)
- Verify: Typecheck / targeted module compile; ApiModule still references
  `loggerModule` + new `register` call.

### Phase 2 — DI + filter behavior specs

- Paths: `exceptions.module.spec.ts`, `global-exception.filter.spec.ts`
- Symbols: Nest `Test.createTestingModule` positive/negative; filter
  `status` / `error` outcomes for `ValidationError`, `NotFoundError`,
  `HttpException`, unknown `Error` (INTERNAL_SERVER_ERROR + logger.error).
- AC: AC-02, AC-03, AC-04 (behavior portion)
- Verify: `npm run test:module -- exceptions.module.spec` (or full
  `test:module`) and `npm run test:unit -- global-exception.filter.spec`
  (adjust to whichever suite glob owns the new files — prefer `*.module.spec.ts`
  under `test:module` and filter under `test:unit` if that matches repo
  conventions).

### Phase 3 — Remove deprecated facades (Option B)

- Paths: six `*Module` files with `forRootFromAppConfig`; delete
  `infrastructure.module.ts`; strip leftover unused imports.
- Symbols removed: `forRootFromAppConfig`, `InfrastructureModule`, `forRoot` on
  that class.
- AC: AC-08 (code portion)
- Verify: `rg forRootFromAppConfig` and `rg InfrastructureModule` over `*.ts`
  show no production symbols left (docs may temporarily still mention until
  Phase 4); `npm run build`.

### Phase 4 — Documentation alignment

- Paths: `docs/infrastructure-modules/README.md`,
  `docs/infrastructure-modules/EXTRACTION_GUIDE.md`, `EXAMPLES.md`, `README.md`,
  `docs/agent-plans/INDEX.md`
- Content: Exceptions API = `register({ imports: [loggerModule] })`; peers =
  configured `LoggerModule`; remove deprecated facade how-tos; note breaking
  removal for external copy-pasters.
- AC: AC-05, AC-08 (docs portion), AC-01 (docs path)
- Verify: Doc sections match code; repo search no contradictory “use
  `forRootFromAppConfig` / `InfrastructureModule.forRoot`” guidance aimed at
  new work. Historical agent-reports / old plans may still mention them as
  past tense — do **not** rewrite unrelated historical reports unless they are
  presented as current how-to (prefer leaving historical reports alone).

### Phase 5 — Full verification + report

- Commands: see Targeted / Full verification.
- AC: AC-06, AC-07
- Verify: No OpenAPI intentional drift; no migration file changes in diff;
  implementation report lists command / result / conclusion.

## Dependency and compatibility impact

- **In-repo:** No production callers of removed facades; API composition update
  only for Exceptions.
- **External / forks:** Breaking — remove `forRootFromAppConfig` and
  `InfrastructureModule`; require `ExceptionsModule.register({ imports })`.
- No new npm dependencies. No env var changes.
- Logger remains `global: true` (TASK-007); this task adds an **explicit** peer
  edge rather than relying on ambient globals alone (NFR-02).

## Targeted verification

```bash
npm run test:module -- exceptions.module.spec
npm run test:unit -- global-exception.filter.spec
npm run build:api
```

(Adjust Jest path args to match how this repo’s scripts forward patterns; if
path filters are unreliable on Windows, run the full `test:module` /
`test:unit` suites.)

Also: `rg "forRootFromAppConfig" --glob "*.ts"` → zero hits;
`rg "InfrastructureModule" --glob "*.ts"` → zero hits (or only comments if any
remain — prefer zero).

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
npm run test:module
```

Optional if local infra available: brief `npm run start:api` smoke — missing
PostgreSQL/Redis is infrastructure unavailability, not a code defect.

OpenAPI drift test: skip unless unexpected OpenAPI files appear in the diff
(AC-06).

## Acceptance criteria mapping

| AC    | Phase(s) | Verification                                                             |
| ----- | -------- | ------------------------------------------------------------------------ |
| AC-01 | 1, 4     | Inspect `exceptions.module.ts` + docs; no ambient-only registration path |
| AC-02 | 2        | `exceptions.module.spec.ts` positive DI with `LoggerModule.forRoot`      |
| AC-03 | 2        | Same file negative DI without logger peer (CI)                           |
| AC-04 | 1, 2     | ApiModule wiring + filter unit mapping assertions                        |
| AC-05 | 4        | Diff README + EXTRACTION_GUIDE Exceptions sections vs code               |
| AC-06 | 5        | Diff review: no intentional OpenAPI/migration changes                    |
| AC-07 | 5        | `npm run build`, `npm run lint`, relevant unit/module tests              |
| AC-08 | 3, 4     | Methods/file gone; docs updated; `rg` on `*.ts` clean                    |

## Rollout strategy

- Normal merge. No migration job, feature flag, or env rollout.
- Call out breaking removal of deprecated facades + Exceptions `register` API in
  docs updated in Phase 4 (release-notes style in infrastructure README /
  EXAMPLES is enough; no separate changelog file required unless one already
  exists and is the project norm — none required by this plan).

## Rollback strategy

- Revert the implementing commit(s). Highest external break risk is Option B
  facade deletion; in-repo risk is low given no callers.

## Risks

| Risk                                                                             | Mitigation                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Negative DI test flakes if another global provider leaks into the testing module | Keep the negative case isolated; do not import `LoggerModule` or ApiModule                                                  |
| `APP_FILTER` retrieval in positive test is awkward                               | Assert `moduleRef.get(APP_FILTER)` is `GlobalExceptionFilter`, or resolve via Nest’s provider token patterns used elsewhere |
| Docs / historical reports still mention facades                                  | Update current how-to docs only; leave historical agent-reports unless they read as live instructions                       |
| INDEX task status still `proposed`                                               | Human sync; does not block plan approval                                                                                    |
| Removing `forRootFromAppConfig` leaves unused imports → lint fail                | Clean imports in the same Phase 3 edit                                                                                      |
| Filter behavior accidentally changed                                             | Unit tests pin status codes and error body shape; do not edit mapping logic                                                 |

## Open questions requiring human decision

These are answered **in this plan as proposals**. Human plan approval locks them;
reply before approval if any proposal is wrong.

1. **Q2 — Exceptions peer API:** Approve
   `ExceptionsModule.register({ imports })` with **required** `imports`, as
   specified above? (Alternative rejected in plan: static `LoggerModule` class
   import.)

2. **Q3 — Negative DI in CI:** Approve requiring
   `exceptions.module.spec.ts` negative case in `npm run test:module`?

3. **Q4 — InfrastructureModule:** Approve **delete file** (no throw stub)?

No other open product questions. Facade disposition Option B is already
specification-approved.
