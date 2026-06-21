# P3-02 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P3-02-sync-readme-entrypoints-features-eventbus.md` (`status: approved`)

## Changed files

| Path        | Change                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` | Synced documentation with four entrypoints, Auth/User demo feature, DomainEventRouter + Outbox semantics, migrations scripts, Docker compose `migrations` service, testing examples, and Definition of Done |

No production code, contracts, DI, or Nest module changes.

## Completed steps

1. **Inventory pass** — re-read README against `AGENTS.md`, `package.json`, `docker-compose.yml`, and auth/outbox/event source files.
2. **Entrypoints (Section 3 + related)** — updated count to four; added `## 3.4. Migrations`; updated intro, structure tree (`apps/migrations/`), `## 4.5. Apps`, `## 8.2. Сервіси`, `## 23`, `## 25`, pre-commit checklist.
3. **Auth feature (Sections 6–7 + scattered examples)** — replaced Users/balance demo with Auth/User reference (`RegisterUseCase`, `auth.controller.ts`, `UserRegisteredEvent`); added implemented-vs-template callout pointing to Section 12.
4. **Domain events (Section 5.12 + EventBus mentions)** — documented Outbox + `DomainEventRouter` two-step model, contracts, `EventsModule.register()`, handler example; removed contradictory generic EventBus claims from intro, flow, testing, and DoD.
5. **Scripts (Section 10 + checklists)** — extended JSON excerpt with `build`, `build:migrations`, `start:prod:*`, `db:migrate:prod`; clarified dev `db:migrate` vs production migrations entrypoint.
6. **Docker migrations (Section 8.4)** — documented `docker compose run --rm migrations` as primary path; kept `api npm run db:migrate` as local dev alternative; added production `db:migrate:prod` cross-link.
7. **Testing & DoD cleanup** — updated §20 examples (`RegisterUseCase` + mocked `IOutboxWriter`); §22 notes migrations one-shot exit; §23 four apps + DomainEventRouter wording.
8. **Self-review** — grep verification for stale strings (see Commands executed).

## Deviations

None. Open questions resolved per plan defaults:

- Section 6 titled **Auth/User feature example (implemented)**.
- Docker migrations: compose `migrations` service first, `api npm run db:migrate` as alternative.
- `user-created.event.ts`: brief note in §6.1 only.
- `package.json` description and `MODULES_OVERVIEW_NON_TECH.md` sync deferred (out of scope).
- Scripts excerpt includes migrations-related additions plus full `start:prod:*` quartet (not release scripts).

Additional alignment (within README-only scope): updated `## 4.3. Contracts` example paths from nonexistent `event-bus.contract.ts` to `domain-event-router.ts` / `domain-event-handler.ts`; updated `## 5.3` Drizzle anti-pattern example from `CreateUserUseCase` to `RegisterUseCase`.

## Commands executed

| Command                                                                                                                                       | Result                                                                     | Conclusion                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| `rg -n "три окремі entrypoint\|EventBusModule\|IEventBus\|users/create-user\|deposit-user-balance\|users\.controller\|POST /users" README.md` | Only match: explicit negation in §5.12 (`немає IEventBus, EventBusModule`) | Stale demo/API paths removed                    |
| `rg -n "migrations\|DomainEventRouter\|UserRegisteredEvent\|auth/register\|db:migrate:prod\|build:migrations" README.md`                      | Matches in Sections 3, 5.12, 6–7, 8, 10, 23, 25, 27                        | New terminology present in expected sections    |
| `npm run lint`                                                                                                                                | Exit 0                                                                     | Full-repo lint gate passes (markdown-only diff) |
| `git diff --stat -- README.md`                                                                                                                | 1 file, +211 / −78 lines                                                   | Scope limited to README                         |

## Command results

- **Stale string grep:** no remaining `три окремі entrypoint`, `users/create-user`, `deposit-user-balance`, `users.controller`, `POST /users`, `UserCreatedEvent`, `CreateUserUseCase`, or generic EventBus promises outside explicit “does not exist” wording.
- **Positive terminology grep:** `migrations`, `DomainEventRouter`, `UserRegisteredEvent`, `auth/register`, `db:migrate:prod`, `build:migrations` appear in entrypoint, feature, scripts, Docker, and DoD sections.
- **Lint:** passes; no TypeScript impact.
- **Diff scope:** only `README.md` modified.

## Acceptance criteria self-check

| Criterion                                                                                                       | Status |
| --------------------------------------------------------------------------------------------------------------- | ------ |
| README separates implemented (Auth demo, four entrypoints, DomainEventRouter + Outbox) from Section 12 template | Met    |
| All four entrypoints documented with paths and deployment model; “three entrypoints” removed                    | Met    |
| Users/balance/`POST /users`/`CreateUserUseCase`/`deposit-user-balance` claims removed; Auth paths used          | Met    |
| Event delivery documented as Outbox → processor → `IDomainEventRouter.route` → handlers                         | Met    |
| No contradictory generic EventBus promises; `IEventBus`/`EventBusModule` not presented as available APIs        | Met    |
| `# 10. Package scripts` includes `build:migrations`, `start:prod:migrations`, `db:migrate:prod`                 | Met    |
| Docker / local migration sections consistent with `docker-compose.yml` and one-shot job semantics               | Met    |
| Plan scope limited to README; no production code changes                                                        | Met    |

## Remaining risks

1. **Large README edit** — possible minor internal wording inconsistencies in distant sections not touched by grep checklist; independent verification recommended.
2. **`user-created.event.ts` orphan** — documented but not wired; separate cleanup backlog item if desired.
3. **`package.json` description** — still says “API/Worker/Cron” only; deferred per plan.
4. **`MODULES_OVERVIEW_NON_TECH.md`** — still lists three entrypoints; deferred per plan.

## Unverified areas

- Runtime execution of `npm run db:migrate:prod` against PostgreSQL (documented only; infrastructure not required for this doc fix).
- Manual operator validation of Docker Compose `migrations` service flow in a fresh environment.
