---
issue_id: P2-20
status: approved
owner: human-approval-required
---

# P2-20 — Add configurable BullMQ key prefix for Redis isolation

## Source issue

- Backlog index: `docs/agent-backlog/INDEX.md` — `P2-20` (Medium, Architectural risk)
- Full issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-20
- Review evidence: `docs/agent-reports/full-review-2026-08-02.md` (BullMQ not isolated by `REDIS_KEY_PREFIX` / no queue prefix)

**Issue validity:** still valid on the current branch (inspected 2026-08-02). No BullMQ `prefix` exists in module options, env schema, mapper, or `BullModule.forRoot*` wiring.

## Current behavior

Confirmed by code inspection:

1. App Redis keys are namespaced via `REDIS_KEY_PREFIX` → `RedisModuleOptions.keyPrefix` → `RedisKeyBuilder` / `RedisService` (`libs/infrastructure/src/redis/*`, `env.schema.ts`, `infrastructure-config.module.ts`).
2. `BullMqModuleOptions` (`libs/infrastructure/src/bullmq/bullmq.module-options.ts`) exposes only `connection` + optional `defaultJobOptions` — **no `prefix`**.
3. `InfrastructureBullMqModule.buildBullConnection` (`libs/infrastructure/src/bullmq/bullmq.module.ts`) returns host/port/password/db/connectTimeout/maxRetriesPerRequest/retryStrategy only.
4. `BullModule.forRoot` / `BullModule.forRootAsync` receive `{ connection: buildBullConnection(...) }` only — BullMQ `QueueOptions.prefix` is never set.
5. `InfrastructureBullMqModule.registerQueues` registers `{ name }` only — no per-queue prefix.
6. `mapAppConfigToBullMqOptions` maps Redis connection + `BULLMQ_DEFAULT_ATTEMPTS` / `BULLMQ_BACKOFF_DELAY`; it does not read or map any prefix (`libs/infrastructure/src/config/create-starter-kit-module-options.ts`).
7. Env surface (`.env.example`, `env.schema.ts`, `AppConfigService` / `ConfigShape.bullmq`) has `BULLMQ_DEFAULT_ATTEMPTS` and `BULLMQ_BACKOFF_DELAY` only.
8. Composition roots API / Worker / Cron all use `InfrastructureBullMqModule.forRootAsync` + `mapAppConfigToBullMqOptions` — they inherit the missing prefix automatically.
9. Nest `@Processor` workers (`apps/worker/src/processors/*`) rely on shared `BullModule.forRoot*` config; they do not set a local prefix.
10. BullMQ / `@nestjs/bullmq` support `prefix?: string` on `QueueOptions` / `BullRootModuleOptions` (default BullMQ prefix is `bull` when omitted). Physical keys remain under `bull:<queue>:…` regardless of `REDIS_KEY_PREFIX`.

## Confirmed root cause

Queue namespace isolation was never plumbed through `BullMqModuleOptions`, env, or `BullModule.forRoot*` even though Redis app-key isolation (`REDIS_KEY_PREFIX`) is a documented starter portability feature. Shared Redis DB deployments can therefore collide on default `bull:*` keys across projects/compositions.

## Dependency/runtime flow

```text
.env / envSchema
  REDIS_KEY_PREFIX  → redis.keyPrefix → RedisModule / RedisKeyBuilder  (app keys only)
  BULLMQ_DEFAULT_ATTEMPTS / BULLMQ_BACKOFF_DELAY → config.bullmq()
       │
       ▼
mapAppConfigToBullMqOptions(AppConfigService)
       │  (today: connection + defaultJobOptions only)
       ▼
InfrastructureBullMqModule.forRootAsync  (API / Worker / Cron)
       │
       ├─► BullModule.forRootAsync({ connection })   ← no prefix today
       └─► BULLMQ_MODULE_OPTIONS → BullQueueGateway (defaultJobOptions only)

InfrastructureBullMqModule.registerQueues([...])
       └─► BullModule.registerQueue({ name })       ← inherits shared forRoot config

Worker @Processor(queueName)
       └─► Nest Worker uses shared BullModule config (must share same prefix as producers)
```

Desired after fix:

```text
BULLMQ_PREFIX (env, default bull) → config.bullmq().prefix
  → BullMqModuleOptions.prefix
  → BullModule.forRoot*({ connection, prefix })
  → Queues + Workers share one namespace
```

## Goal

Allow integrators to set a BullMQ Redis key prefix via typed module options and env without editing module internals, so two compositions with different prefixes do not share BullMQ key namespaces on the same Redis DB, while keeping the default backward-compatible (or documenting a deliberate break if humans choose derivation).

## Scope

- Add optional `prefix` to `BullMqModuleOptions` and pass it into `BullModule.forRoot` / `forRootAsync` as top-level `QueueOptions.prefix` (not inside the ioredis connection object).
- Plumb env → `AppConfigService` / `ConfigShape.bullmq` → `mapAppConfigToBullMqOptions`.
- Update `.env.example` and infrastructure / README BullMQ docs to state that `REDIS_KEY_PREFIX` does **not** cover BullMQ keys; use the new BullMQ prefix for queue isolation.
- Unit/config coverage proving options mapping and that `forRoot` / `forRootAsync` root options include the configured prefix.

## Out of scope

- P2-16 … P2-19 and all other backlog items.
- Wiring `defaultJobOptions` into `BullModule.forRoot*` (today applied only in `BullQueueGateway`; separate concern).
- Changing `REDIS_KEY_PREFIX` / `RedisKeyBuilder` behavior or forcing BullMQ to reuse the Redis app prefix automatically (unless human selects that open-question alternative).
- Per-queue prefix overrides in `registerQueues`.
- HTTP endpoints, OpenAPI, or Postman (`docs/postman/`) — this is not an HTTP contract change.
- Redis DB / connection splitting, multi-tenant runtime design, or migrating existing `bull:*` keys in deployed Redis.
- Changing Worker `@Processor` signatures beyond inheriting shared `forRoot` prefix.
- Fixing unrelated docs drift (e.g. infrastructure README starter queue table vs API registering `EMAIL`).

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None required. Prefer extending `libs/infrastructure/src/bullmq/bullmq.module.spec.ts`. Optional tiny mapper unit assertions may live in that same spec (or a focused `create-starter-kit-module-options` bullmq case) without a new production file.

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `libs/infrastructure/src/bullmq/bullmq.module-options.ts` | Extend `BullMqModuleOptions` with optional `prefix?: string` (document: BullMQ queue key prefix; omit/`bull` = library default). |
| `libs/infrastructure/src/bullmq/bullmq.module.ts` | Replace connection-only wiring: add helper (e.g. `buildBullRootOptions`) returning `{ connection: buildBullConnection(options), prefix: options.prefix }` (omit `prefix` when undefined so BullMQ keeps default `bull`, **or** always pass explicit default after human decision). Use it in `forRoot` and `forRootAsync` `useFactory` return value. Do not put `prefix` inside ioredis connection fields. |
| `libs/infrastructure/src/config/env.schema.ts` | Add `BULLMQ_PREFIX` (recommended name) with default `'bull'` for backward compatibility. |
| `libs/infrastructure/src/config/app-config.service.ts` | Extend `ConfigShape['bullmq']` with `prefix: string`; `bullmq()` continues to return that shape. |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Map `e.BULLMQ_PREFIX` into `bullmq.prefix`. |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | `mapAppConfigToBullMqOptions`: set `prefix: bullmqConfig.prefix` on returned `BullMqModuleOptions`. |
| `libs/infrastructure/src/bullmq/bullmq.module.spec.ts` | Assert `forRoot` / `forRootAsync` shared config carries configured `prefix`; assert default/omitted behavior matches approved default; keep existing `registerQueues` name assertion. |
| `.env.example` | Document `BULLMQ_PREFIX` next to other BullMQ vars; note it is independent of `REDIS_KEY_PREFIX` and should differ per project when sharing one Redis DB. |
| `README.md` | § BullMQ Module (and env example block ~`BULLMQ_*`): document configurable prefix, isolation guidance, and breaking-change note when changing prefix on an existing Redis (orphan old `bull:*` / prior-prefix keys). Clarify Redis section so readers do not assume `REDIS_KEY_PREFIX` covers queues. |
| `docs/infrastructure-modules/README.md` | `InfrastructureBullMqModule` example: include `prefix` in `forRootAsync` options sample. |
| `docs/agent-plans/INDEX.md` | Register this plan row while `proposed` (planner hygiene; not production). |

## Files to delete

- None.

## Contract and DI changes

- **`libs/contracts`:** no changes (`IQueueGateway` / queue names unchanged).
- **`BullMqModuleOptions`:** additive optional `prefix?: string`.
- **Env / config:** additive `BULLMQ_PREFIX` → `config.bullmq().prefix`.
- **DI tokens:** `BULLMQ_MODULE_OPTIONS` value gains `prefix`; no new tokens.
- **Composition roots** (`apps/api/src/api.module.ts`, `apps/worker/src/worker.module.ts`, `apps/cron/src/cron.module.ts`): **no structural change** if they keep `mapAppConfigToBullMqOptions`; they pick up prefix via the mapper. Direct `forRoot({…})` callers outside the kit must pass `prefix` themselves (document in README / infrastructure-modules).
- **Public behavior:** default prefix remains BullMQ’s `bull` under the recommended approach (AC-03 compatible). Changing `BULLMQ_PREFIX` later is a deliberate Redis namespace cutover.

## Implementation steps

1. **Confirm Nest/BullMQ placement:** `prefix` belongs on `BullModule.forRoot*` / `QueueOptions`, shared by registered queues and Nest workers — not on the ioredis connection object and not required on each `registerQueue({ name })` when forRoot sets it.
2. **Extend `BullMqModuleOptions`** with `prefix?: string`.
3. **Wire `buildBullRootOptions(options)`** in `bullmq.module.ts` and use it in both `forRoot` and `forRootAsync` instead of `{ connection: buildBullConnection(...) }` only.
4. **Env + config shape:** add `BULLMQ_PREFIX` default `'bull'` in `env.schema.ts`; map in `infrastructure-config.module.ts`; type in `AppConfigService` `ConfigShape.bullmq`.
5. **Mapper:** `mapAppConfigToBullMqOptions` copies `prefix`.
6. **Docs / `.env.example`:** document independence from `REDIS_KEY_PREFIX`, shared-Redis guidance, and rollout caution when changing prefix.
7. **Tests:** extend `bullmq.module.spec.ts` to inspect `forRoot` imports / async factory output for `prefix`; cover mapper or config path asserting env default and custom value. Prefer pure unit checks without opening Redis connections.
8. **Do not** change backlog INDEX status or mark P2-20 resolved.

## Migration and rollout concerns

- **Default `'bull'`:** existing single-tenant deployments keep seeing the same keys — no migration.
- **Setting a custom prefix:** new keys land under `{prefix}:<queue>:…`; old `bull:*` (or prior prefix) jobs become invisible to producers/consumers. Drain/complete queues before cutover, or accept orphaned keys / flush only the old BullMQ key space with explicit human approval.
- **API + Worker + Cron** must share the same `BULLMQ_PREFIX` in each environment; mismatch looks like “empty queues” / jobs never consumed.
- **Copy-kit multi-project on one Redis DB:** set distinct `BULLMQ_PREFIX` (and usually distinct `REDIS_KEY_PREFIX`) per project.

## Targeted verification

| Command | Purpose |
| --- | --- |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/bullmq/bullmq.module.spec.ts` | Prefix present in forRoot/forRootAsync options; registerQueues still registers names. |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/bullmq/queue.gateway.spec.ts` | Gateway still builds job options (regression). |
| `node node_modules/jest/bin/jest.js --config jest.unit.config.ts libs/infrastructure/src/config/env.schema.spec.ts` | Env schema still valid; add/assert `BULLMQ_PREFIX` default if covered. |
| `npm run build` | Shared infrastructure + apps compile after options/config shape change. |
| `npm run lint` | No new lint issues on touched files. |

## Full verification

| Command | Purpose |
| --- | --- |
| `npm run build` | Full compile. |
| `npm run lint` | Lint gate. |
| `npm run test:unit` | Fast unit gate including new/updated BullMQ/config specs. |
| `npm run test:module` | Module bootstrap still works for API/Worker/Cron BullMQ wiring (note: P2-16 may still fail Cron ioredis mock independently — report separately; do not expand this plan to fix P2-16). |

Do not require `npm run test:int` or live Redis for AC completion if unit/config evidence shows prefix is passed into Bull root options; optional manual Redis key inspection is nice-to-have only when infra is available.

## Acceptance criteria

- **AC-01:** Integrators can set a BullMQ prefix via `BullMqModuleOptions.prefix` and via env (`BULLMQ_PREFIX`) / `mapAppConfigToBullMqOptions` without editing `bullmq.module.ts` internals.
- **AC-02:** Documented + unit/config evidence that two option sets with different `prefix` values produce different Bull root `prefix` configuration (same Redis connection settings may still be used). Docs state that distinct prefixes isolate BullMQ key namespaces on one Redis DB.
- **AC-03:** Default remains BullMQ-compatible `bull` (recommended) **or**, if humans approve derivation from `REDIS_KEY_PREFIX`, the plan’s open question is answered and the breaking behavior is documented in README / `.env.example`.
- Composition roots continue to share one mapped prefix across API, Worker, and Cron through the existing mapper — no divergent hardcoded prefixes introduced.
- No HTTP/OpenAPI/Postman work invented for this issue.

## Risks

- Operators set `BULLMQ_PREFIX` only on one entrypoint → producers and consumers diverge.
- Confusing `REDIS_KEY_PREFIX` with BullMQ prefix → false sense of queue isolation until docs are read.
- If humans choose auto-derive from `REDIS_KEY_PREFIX` as default, existing `bull:*` deployments break without an env change.
- `test:module` may still fail for unrelated P2-16 Cron ioredis mock; implementers must not treat that as P2-20 scope creep.

## Rollback strategy

- Revert the additive options/env/docs/test changes. With default `bull`, rollback restores prior key namespace automatically for default deployments.
- If a custom prefix was already used in production, rolling back to `bull` without draining leaves jobs under the custom prefix orphaned — drain or keep the custom value until empty.

## Open questions requiring human decision

1. **Default strategy (AC-03):** Recommended — env `BULLMQ_PREFIX` default `'bull'` (backward compatible). Alternative — derive default from `REDIS_KEY_PREFIX` (e.g. `` `${REDIS_KEY_PREFIX}` `` or `` `${REDIS_KEY_PREFIX}:bull` ``), which is a deliberate breaking change for any existing `bull:*` data. Which default should implementers ship?
2. **Env name:** Prefer `BULLMQ_PREFIX` (aligns with BullMQ option name). Acceptable alternate: `BULLMQ_KEY_PREFIX`. Confirm naming.
3. **Validation:** Should empty/`bull`/`whitespace` prefixes be rejected, or allow empty string to mean “BullMQ library default”? Recommended: non-empty string after trim; default `'bull'`.
4. **Docs language depth:** Is updating `README.md` + `.env.example` + `docs/infrastructure-modules/README.md` sufficient, or should `MODULES_OVERVIEW_NON_TECH.md` also mention queue Redis isolation for non-technical readers?
