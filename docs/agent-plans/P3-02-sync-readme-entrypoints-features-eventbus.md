---
issue_id: P3-02
status: proposed
owner: human-approval-required
---

# P3-02 — Sync README with actual entrypoints, features, and DomainEventRouter semantics

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — **P3-02. Синхронізувати README з фактичними entrypoint, features та EventBus semantics** (Low / Documentation mismatch).

Related mismatch table row (same backlog doc, section 5): three entrypoints vs four; users/balance paths presented as ready; generic EventBus vs `DomainEventRouter`.

## Current behavior

`README.md` presents a partially outdated picture of the starter kit:

1. **Entrypoints (three vs four)**
   - Intro bullet list (lines ~11): `api`, `worker`, `cron` only.
   - Section `# 3. Entry points` (line ~154): “Проєкт має три окремі entrypoint-и.” Subsections cover API, Worker, Cron only — no Migrations app.
   - Structure tree `## 2.1. Структура` (lines ~66–88): lists `api`, `worker`, `cron` under `apps/` — no `migrations/`.
   - `## 4.5. Apps` (lines ~391–393): three composition examples only.
   - `## 8.2. Сервіси` (lines ~1628–1643): Docker services list three runtime entrypoints; omits `migrations` service that exists in `docker-compose.yml`.
   - `# 23. Definition of Done` (line ~2486): “є окремі apps: `api`, `worker`, `cron`”.
   - `# 25. Корисні команди` and pre-commit checklist (lines ~1804–1808): no migrations build/start commands.

   **Actual:** fourth entrypoint `apps/migrations` registered in `nest-cli.json`, bootstrapped by `apps/migrations/src/main.ts` → `runMigrations()` with PostgreSQL advisory lock (`apps/migrations/src/migration-lock.ts`). Documented correctly in `AGENTS.md` as a one-shot deployment job.

2. **Demo feature (users/balance vs Auth/User)**
   - Intro (line ~29): “приклад feature-модуля `users`”.
   - Structure tree (line ~103): `use-cases/users/` — directory does not exist.
   - `## 4.2. Application` example path (line ~313): `libs/application/src/use-cases/users/create-user.usecase.ts` — **missing**.
   - `# 6. Users feature example` and `# 7. Users flow` (lines ~1461–1598): document `CreateUserUseCase`, `deposit-user-balance.usecase.ts`, `users.controller.ts`, `POST /users`, `UserCreatedEvent`, balance responsibilities — **mostly absent from codebase**.
   - `# 20.1` / `# 20.2` (lines ~2324–2339): `User.depositBalance()`, `CreateUserUseCase`, `mock<IEventBus>()` — not implemented.

   **Actual demo feature:** Auth/User under `apps/api/src/controllers/auth.controller.ts`, `libs/application/src/use-cases/auth/*`, `apps/api/src/composition/auth-application.module.ts`. Registration flow uses `RegisterUseCase` → `IOutboxWriter.append(UserRegisteredEvent)` (not `UserCreatedEvent`). `User` entity (`libs/domain/src/entities/user.entity.ts`) has no balance API. `IUserRepository` (`libs/contracts/src/repositories/user.repository.ts`) supports auth-oriented methods including `incrementAuthVersion`. `EXAMPLES.md` (line ~677) already points to auth as the reference implementation.

3. **EventBus semantics (inconsistent within README)**
   - Intro (line ~23): lists “event bus” as included.
   - `## 5.12. Domain Events` (line ~1040): “Окремий `EventBusModule` у поточній реалізації відсутній.”
   - `# 7. Users flow` step 9 (line ~1595): “EventBus записує event в Outbox або обробляє in-memory”.
   - `# 23. Definition of Done` (line ~2499): “є event bus”.
   - `# 20.2` (lines ~2337–2339): `mock<IEventBus>()` — **no `IEventBus` contract exists**.

   **Actual:**
   - Use cases write domain events transactionally via `IOutboxWriter` (`libs/contracts/src/outbox/outbox-writer.ts`).
   - `DrizzleOutboxProcessor` (`libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`) publishes by calling `IDomainEventRouter.route()`.
   - `DomainEventRouter` (`libs/infrastructure/src/events/domain-event.router.ts`) dispatches to registered `IDomainEventHandler` implementations via `EventsModule.register()` (`libs/infrastructure/src/events/events.module.ts`).
   - Example handler: `UserRegisteredEventHandler` enqueues welcome email to BullMQ — not a generic async integration bus.

4. **Package scripts excerpt incomplete**
   - `# 10. Package scripts` (lines ~1757–1780): JSON excerpt omits migrations-related scripts present in `package.json`:
     - `build:migrations`
     - `start:prod:migrations`
     - `db:migrate:prod`
     - aggregate `build` (includes migrations)
   - Same section omits production start scripts (`start:prod:api|worker|cron|migrations`) that exist in `package.json`.
   - Internal inconsistency: `# 27` agent verification table (line ~2906) already references `npm run build:migrations`.

5. **Docker migrations guidance**
   - `## 8.4. Міграції` (line ~1680): `docker compose run --rm api npm run db:migrate`.
   - `docker-compose.yml` defines a dedicated `migrations` service (`command: npm run db:migrate`) that API/worker/cron depend on — README does not document this deployment model or the production `db:migrate:prod` path.

## Confirmed root cause

README was not updated after:

- addition of the **Migrations** fourth entrypoint and production migration scripts;
- replacement of the illustrative **users/balance** vertical slice with the shipped **Auth/User** demo (`RegisterUseCase`, JWT/session, outbox + `UserRegisteredEvent`);
- introduction of **`DomainEventRouter` / `EventsModule`** and removal of any generic `EventBusModule` / `IEventBus` contract.

The backlog issue is **not stale** — mismatches remain on current branch (`main`-line working tree; no pending README edits in git).

## Dependency/runtime flow

Documented target flow (Auth registration — matches code):

```text
POST /auth/register (AuthController)
  -> RegisterUseCase.execute()
       -> ITransactionManager.run()
            -> IUserRepository.insert(User, trx)
            -> IOutboxWriter.append(UserRegisteredEvent, trx)
  -> (async) Cron enqueues outbox job / Worker processes outbox batch
       -> DrizzleOutboxProcessor.publishEvent()
            -> IDomainEventRouter.route(RoutableDomainEvent)
                 -> UserRegisteredEventHandler.handle()
                      -> IQueueGateway.add(QUEUES.EMAIL, ...)
       -> mark outbox row processed
  -> EmailProcessor sends welcome email
```

Migrations deployment flow (to document in README):

```text
build:migrations -> dist/apps/migrations/main.js
db:migrate:prod / start:prod:migrations
  -> runMigrations()
       -> acquireMigrationAdvisoryLock (PostgreSQL session lock)
       -> drizzle-orm migrate(migrationsFolder)
       -> release lock, exit
```

Local/dev alternative (already in package.json): `db:migrate` → `drizzle-kit migrate` (not the migrations app entrypoint).

## Goal

Align `README.md` with the actual four-entrypoint architecture, Auth/User demo feature, and `DomainEventRouter` + Outbox event pipeline — clearly separating **implemented** behavior from **patterns to copy** when adding new features.

## Scope

Documentation-only changes to **`README.md`**:

- Enumerate and describe all **four** entrypoints (API, Worker, Cron, Migrations) with paths, purpose, constraints, and npm scripts.
- Replace the outdated **Users/balance** feature sections with the **Auth/User** reference feature using real paths, routes, events, and composition modules.
- Rewrite **Domain Events** documentation: `EventsModule`, `IDomainEventRouter`, `IDomainEventHandler`, `IOutboxWriter`; remove contradictory “event bus” claims and nonexistent `IEventBus` / `EventBusModule` references.
- Expand **`# 10. Package scripts`** (and related checklists) to include migrations scripts and note dev vs production migration commands.
- Update **Docker** sections to mention the `migrations` compose service and distinguish dev (`db:migrate`) vs production (`db:migrate:prod`) migration execution.
- Fix **Definition of Done**, intro bullet list, structure tree, and testing examples to match reality.

Use **`AGENTS.md`**, **`EXAMPLES.md`** (auth reference line), and **`package.json`** as authoritative cross-checks — do not contradict them.

## Out of scope

- Production code, contracts, DI, or Nest module changes.
- Fixing `package.json` `"description"` field (still says “API/Worker/Cron” only) — note as optional follow-up unless human approves bundling.
- Syncing `MODULES_OVERVIEW_NON_TECH.md`, `EXAMPLES.md` users-controller tutorial paths, or other docs beyond README (unless human expands scope).
- Removing or repurposing unused domain artifact `libs/domain/src/events/user-created.event.ts` (orphaned file; separate cleanup if desired).
- P3-03 (`.env.example` / Redis startup log prefix).
- Runtime verification of migrations against PostgreSQL (document commands only).

## Files to create

| Path     | Responsibility                                                             |
| -------- | -------------------------------------------------------------------------- |
| _(none)_ | Plan-only issue; no new production or doc files required beyond this plan. |

## Files to modify

| Path        | Symbols / sections to change                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md` | **Intro bullet list (~lines 7–32):** replace “three apps” / “users” / “event bus” with four entrypoints, Auth demo feature, Domain Events + Outbox wording.                                                                                                                                                                                                                    |
| `README.md` | **`## 2.1. Структура` (~lines 65–88):** add `apps/migrations/` tree; change `use-cases/users/` → `use-cases/auth/`; optional note that `user-created.event.ts` exists but demo uses `user-registered.event.ts`.                                                                                                                                                                |
| `README.md` | **`# 3. Entry points` (~lines 152–249):** change “три” → “чотири”; add **`## 3.4. Migrations`** covering `apps/migrations`, one-shot job semantics, advisory lock, `npm run build:migrations`, `npm run db:migrate:prod` / `start:prod:migrations`, explicit “must not host HTTP/BullMQ/cron”.                                                                                 |
| `README.md` | **`## 4.2. Application` (~lines 310–314):** example path → `libs/application/src/use-cases/auth/register.usecase.ts`.                                                                                                                                                                                                                                                          |
| `README.md` | **`## 4.5. Apps` (~lines 391–393):** add migrations composition note (minimal module graph — no HTTP/processors).                                                                                                                                                                                                                                                              |
| `README.md` | **`## 5.12. Domain Events` (~lines 1038–1041):** replace “EventBusModule absent” stub with `EventsModule.register()`, `DomainEventRouter`, `IDomainEventRouter`, `IDomainEventHandler`, `TOKENS.DomainEventRouter`, handler registration pattern; state there is **no** generic `IEventBus`.                                                                                   |
| `README.md` | **`# 6` / `# 7` (~lines 1461–1598):** rename to Auth feature example; replace paths with `auth.controller.ts`, `register.usecase.ts`, `login.usecase.ts`, etc.; route `POST /auth/register`; event `UserRegisteredEvent`; remove balance/deposit/`users.controller.ts` claims; flow step 9 → `IOutboxWriter.append` in transaction, later `DomainEventRouter.route` in worker. |
| `README.md` | **`## 8.2. Сервіси` (~lines 1628–1643):** add `migrations` service; four entrypoint launch mapping.                                                                                                                                                                                                                                                                            |
| `README.md` | **`## 8.4. Міграції` (~lines 1669–1687):** document compose `migrations` service; local `npm run db:migrate`; production `npm run db:migrate:prod`; avoid implying migrations run inside API process at startup.                                                                                                                                                               |
| `README.md` | **`# 10. Package scripts` (~lines 1755–1780):** extend JSON excerpt with `build`, `build:migrations`, `start:prod:*`, `db:migrate:prod`; brief comment on dev vs prod migration scripts.                                                                                                                                                                                       |
| `README.md` | **Pre-commit / `# 25` checklists (~lines 1804–1808, 2535+):** optionally include `build:migrations` where migration code is touched (align with §27 table).                                                                                                                                                                                                                    |
| `README.md` | **`# 20. Testing strategy` (~lines 2324–2339):** remove `User.depositBalance()` / `CreateUserUseCase` / `IEventBus`; use `RegisterUseCase` with mocked `IOutboxWriter` or `UserRegisteredEvent` domain tests.                                                                                                                                                                  |
| `README.md` | **`# 23. Definition of Done` (~lines 2484–2509):** four apps including migrations; “Domain event router + outbox” instead of “event bus”; “приклад Auth feature” instead of “users”.                                                                                                                                                                                           |
| `README.md` | **Graceful shutdown bullet (~line 2509):** note migrations is one-shot (exit after run) — not long-running graceful shutdown like API/Worker/Cron.                                                                                                                                                                                                                             |

## Files to delete

| Path     | Reason                   |
| -------- | ------------------------ |
| _(none)_ | Documentation sync only. |

## Contract and DI changes

**None.** This issue is README-only. Document existing contracts without renaming:

| Contract / module          | Document as                                                                    |
| -------------------------- | ------------------------------------------------------------------------------ |
| `IDomainEventRouter`       | `libs/contracts/src/events/domain-event-router.ts` — `route(event)`            |
| `IDomainEventHandler`      | `libs/contracts/src/events/domain-event-handler.ts` — `supports()`, `handle()` |
| `TOKENS.DomainEventRouter` | `libs/contracts/src/tokens.ts`                                                 |
| `EventsModule.register()`  | `libs/infrastructure/src/events/events.module.ts`                              |
| `DomainEventRouter`        | `libs/infrastructure/src/events/domain-event.router.ts`                        |
| `IOutboxWriter`            | outbox append in use cases                                                     |
| `DrizzleOutboxProcessor`   | worker-side publish → `route()`                                                |

Explicitly document that **`IEventBus` / `EventBusModule` do not exist** and must not be used in examples.

## Implementation steps

1. **Inventory pass** — re-read `README.md`, `AGENTS.md` (Migrations + entrypoints), `package.json` scripts, `docker-compose.yml` `migrations` service, and auth/outbox/event files listed above; mark every stale line reference.

2. **Entrypoints (Section 3 + related)**
   - Update count and intro references to four entrypoints.
   - Add `## 3.4. Migrations` with path `apps/migrations`, bootstrap `main.ts`, `runMigrations()`, advisory lock behavior summary, scripts, deployment model (one-shot job, not side effect of API/Worker/Cron startup).
   - Update structure tree, §4.5, §8.2, §23, §25.

3. **Auth feature (Sections 6–7 + scattered examples)**
   - Retitle `# 6` → Auth/User demo (or equivalent Ukrainian title consistent with doc tone).
   - List real files: domain `user.entity.ts`, `user-registered.event.ts`; contracts `user.repository.ts`; application auth use cases; infrastructure `user-drizzle.repository.ts`, `user.mapper.ts`; API `auth.controller.ts`, `auth-application.module.ts`.
   - Replace `# 7` flow: `POST /auth/register`, outbox append, worker routing, welcome email — mirror `RegisterUseCase` and `UserRegisteredEventHandler`.
   - Add short “implemented vs template” callout: Section `# 12. Як додати нову feature` remains the pattern for **new** features (e.g. orders); Auth is the **shipped** reference.

4. **Domain events (Section 5.12 + EventBus mentions)**
   - Replace stub with two-step model: (a) transactional outbox write in use case; (b) async `DomainEventRouter.route` in outbox processor.
   - Document handler example `UserRegisteredEventHandler` → email queue.
   - Global search within README for `EventBus`, `event bus`, `IEventBus`, `EventBusModule`; replace or remove consistently (intro, §7, §20, §23).

5. **Scripts (Section 10 + checklists)**
   - Sync excerpt with `package.json`: at minimum `build:migrations`, `start:prod:migrations`, `db:migrate:prod`, and note aggregate `build`.
   - Clarify: `db:migrate` = drizzle-kit (dev/local); `db:migrate:prod` = migrations entrypoint (production job).

6. **Docker migrations (Section 8.4)**
   - Prefer documenting `docker compose run --rm migrations` (matches compose file) while noting `api npm run db:migrate` as alternative if intentional.
   - Cross-link §3.4 production command.

7. **Testing & DoD cleanup** — fix §20 examples and §23 checklist per scope table.

8. **Self-review** — grep README for stale strings: `три entrypoint`, `users/create-user`, `deposit-user-balance`, `users.controller`, `EventBus`, `IEventBus`, `UserCreatedEvent` (in demo flow), `POST /users`, missing `migrations`.

## Migration and rollout concerns

- **No runtime migration.** Documentation-only; zero deploy impact.
- **Operator communication:** README will state production migrations run via dedicated job (`db:migrate:prod`), aligning with `AGENTS.md` safety guidance — reduces risk of teams running drizzle-kit inside API containers in production.
- **Breaking doc expectation:** Readers who relied on Users API paths must be directed to Auth routes — intentional correction.

## Targeted verification

| Command                                                       | Expected result                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------- | ----------------- | -------------------- | ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `rg -n "три окремі entrypoint                                 | EventBusModule                                                    | IEventBus           | users/create-user | deposit-user-balance | users\.controller            | POST /users" README.md`                      | No matches (or only explicit “does not exist” negations in Domain Events section). |
| `rg -n "migrations                                            | DomainEventRouter                                                 | UserRegisteredEvent | auth/register     | db:migrate:prod      | build:migrations" README.md` | Matches in Sections 3, 5.12, 6–7, 8, 10, 23. |
| Manual diff review vs `package.json` scripts block            | Migrations scripts in README excerpt match declared scripts.      |
| Manual diff review vs `apps/migrations/src/run-migrations.ts` | Advisory lock + `DATABASE_URL` requirements accurately described. |

## Full verification

| Command              | Expected result                                                               |
| -------------------- | ----------------------------------------------------------------------------- |
| `npm run lint`       | Pass (markdown-only change; no code impact).                                  |
| `git diff README.md` | Shows only documentation edits scoped to P3-02; no production paths modified. |

No `npm run build` required — no TypeScript changes.

## Acceptance criteria

Map to backlog “Потрібно змінити”:

- [ ] README clearly separates **implemented** (Auth demo, four entrypoints, DomainEventRouter + Outbox) from **example to create** (Section 12 orders-style guidance).
- [ ] All four entrypoints documented with real paths and deployment model; “three entrypoints” wording removed.
- [ ] Users/balance/`POST /users`/`CreateUserUseCase`/`deposit-user-balance` claims removed or reframed as non-shipped; Auth/User paths used instead.
- [ ] Event delivery documented as `IOutboxWriter` → outbox processor → `IDomainEventRouter.route` → handlers; no contradictory generic EventBus promises; `EventBusModule`/`IEventBus` not presented as available APIs.
- [ ] `# 10. Package scripts` includes `build:migrations`, `start:prod:migrations`, `db:migrate:prod` (and context for dev `db:migrate`).
- [ ] Docker / local migration sections consistent with `docker-compose.yml` and production one-shot job semantics.
- [ ] Plan scope limited to README; no production code changes.

## Risks

| Risk                                                                           | Mitigation                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Large README edit introduces new internal contradictions                       | Use grep checklist in step 8; align with `AGENTS.md`.                                           |
| Ukrainian/English mixed technical terms                                        | Keep existing README language; use `DomainEventRouter` as proper name consistently.             |
| `user-created.event.ts` confuses readers                                       | Brief note: file exists but demo flow uses `UserRegisteredEvent`; no code change in this issue. |
| Docker doc change (`migrations` service vs `api`) affects existing user habits | Document compose-native path first; mention alternative if kept.                                |

## Rollback strategy

Revert the single commit or `git checkout -- README.md` — no schema, config, or runtime dependency.

## Open questions requiring human decision

1. **Section 6 title/language:** Rename to “Auth feature example” vs keep “Users” wording but clarify it covers user registration via Auth API?
2. **Docker migrations command:** Standardize on `docker compose run --rm migrations` only, or keep both `migrations` service and `api npm run db:migrate` as documented options?
3. **`user-created.event.ts`:** README-only note vs separate backlog item to remove or wire up unused domain event?
4. **`package.json` description** (“API/Worker/Cron”): update in same PR as README or defer?
5. **Scope expansion:** Should `MODULES_OVERVIEW_NON_TECH.md` entrypoint sentence (API/Worker/Cron only, line ~112) be synced in the same issue despite backlog primary README scope?
6. **Scripts excerpt completeness:** Include full production `start:prod:*` quartet and release scripts, or only migrations-related additions required by P3-02?
