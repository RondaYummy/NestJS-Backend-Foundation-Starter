# V-20 — Implementation report

## Verdict

**implemented** (verification completed; no production code changes in this session)

## Approved plan

`docs/agent-plans/V-20-redis-key-prefix-verification.md` — `status: approved`

V-20 is a **verification** backlog item. The underlying fix was delivered by **P2-14** (`docs/agent-plans/P2-14-centralized-redis-key-prefix.md`, `status: approved`). This session performed independent verification per the V-20 plan and produced `docs/agent-reports/V-20-verification.md`.

## Changed files

None in this session (read-only verification).

**P2-14 artifacts verified (pre-existing on branch):**

| Path | Role |
| ---- | ---- |
| `libs/infrastructure/src/redis/redis-key-builder.ts` | Single namespace builder |
| `libs/infrastructure/src/redis/redis-key-builder.spec.ts` | Normalization + six-area segment cases |
| `libs/infrastructure/src/redis/redis.service.ts` | Centralized prefixing for all key-bearing methods |
| `libs/infrastructure/src/redis/redis.service.spec.ts` | Prefix on get/set/eval/scan/unlink/setPxIfNotExists |
| `libs/infrastructure/src/redis/redis.module.ts` | Registers/exports `RedisKeyBuilder`; wires into `RedisService` |
| `libs/infrastructure/src/redis/redis.module.spec.ts` | Boot with `keyPrefix: 'tenant-a'` |
| `libs/infrastructure/src/config/env.schema.ts` | `REDIS_KEY_PREFIX` (default `app`) |
| `libs/infrastructure/src/config/infrastructure-config.module.ts` | Maps env → `redis.keyPrefix` |
| `libs/infrastructure/src/config/create-starter-kit-module-options.ts` | `mapAppConfigToRedisOptions` returns full `config.redis()` |
| `libs/infrastructure/src/cache/redis-cache.gateway.ts` | No local `app:` prefix |
| `libs/infrastructure/src/locks/redis-distributed-lock.ts` | Uses `RedisService`, not `REDIS_CLIENT` |
| `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` | TypeScript GET/DEL family revocation (no Lua bypass) |
| `.env.example`, `README.md`, `docs/infrastructure-modules/README.md` | Namespace documentation |

## Completed steps

1. Confirmed P2-14 plan approved and implementation present on branch.
2. Ran static namespace contract review (grep for bypass paths, code inspection of `RedisService.eval`, JWT family revocation, composition wiring).
3. Confirmed feature adapters do not read `REDIS_KEY_PREFIX` directly.
4. Ran targeted unit/module specs, full Redis unit folder, build, lint, and optional cache int-spec.
5. Verified documentation alignment (`.env.example`, README §5.4, infrastructure modules README).
6. Wrote `docs/agent-reports/V-20-verification.md` with verdict **approved**.

## Deviations

- Plan lists raw `npx jest` invocations; executed via `npm run test:unit` / `npm run test:module` per V-14 Jest suite split.
- `npm run test:unit -- libs/infrastructure/src/redis` first attempt failed with Windows exit code `-1073741819` (transient crash); retry succeeded (exit 0, 20 tests passed).

## Commands executed

```bash
rg "private readonly prefix = 'app:'" libs/infrastructure/src
rg "REDIS_CLIENT" libs/infrastructure/src/locks
npm run test:unit -- libs/infrastructure/src/redis/redis-key-builder.spec.ts libs/infrastructure/src/redis/redis.service.spec.ts libs/infrastructure/src/cache/redis-cache.gateway.spec.ts libs/infrastructure/src/idempotency/redis-job-execution.store.spec.ts --forceExit
npm run test:module -- libs/infrastructure/src/redis/redis.module.spec.ts --forceExit
npm run test:unit -- libs/infrastructure/src/redis --forceExit
npm run build
npm run lint
npm run test:int -- libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts --runInBand --forceExit
```

## Command results

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `rg "prefix = 'app:'"` (cache bypass) | No matches | AC-2 — no adapter-owned global prefix |
| `rg "REDIS_CLIENT"` (locks) | No matches | AC-2 — lock uses `RedisService` |
| `npm run test:unit --` (4 targeted specs) | Exit 0; 31 tests passed | AC-5 namespace test evidence |
| `npm run test:module -- redis.module.spec.ts` | Exit 0; 1 test passed | AC-3 configurable namespace |
| `npm run test:unit -- libs/infrastructure/src/redis` | Exit 0 on retry; 20 tests passed | Full Redis unit folder |
| `npm run build` | Exit 0 | AC-9 |
| `npm run lint` | Exit 0 | AC-10 |
| `npm run test:int -- redis-cache.gateway.int-spec.ts` | Exit 0; 1 test passed | AC-7 optional runtime evidence |

## Acceptance criteria self-check

All AC-1 through AC-10 from the V-20 plan pass. See `docs/agent-reports/V-20-verification.md` for per-criterion evidence.

## Remaining risks

- **Breaking Redis key migration** on deploy or prefix change — documented in README; consumers must flush or migrate.
- **BullMQ keys** remain on separate `bull:…` namespace — explicitly deferred per plan.
- **Empty `REDIS_KEY_PREFIX`** allowed but collision-prone — documented.

## Unverified areas

- Full `npm run test:all` not executed in this session.
- API bootstrap (`npm run start:api`) not executed — optional per plan.
- Independent verifier role fulfilled in-session; human acceptance of verification report still required per agent workflow.
