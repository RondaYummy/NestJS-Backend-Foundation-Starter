---
issue_id: P3-09
status: approved
owner: human-approval-required
---

# P3-09 — Fix integration-test open-handle leak / Jest force-exit

## Source issue

- Backlog ID: `P3-09`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-09
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (`npm run test:int` → 4 suites / 8 tests passed with open-handle / force-exit warning; also noted under the P2-17 silent-skip finding)
- Classification: Likely defect (still present on current `main`, inspected 2026-08-02)

## Current behavior

Confirmed on current branch (static inspection; no production code changed for this plan):

1. **Jest integration runner**
   - `package.json` script `test:int` → `jest --config jest.integration.config.ts`.
   - `jest.integration.config.ts` spreads `jest.config.base.ts` and matches `**/*.int-spec.ts` only.
   - Neither `jest.integration.config.ts` nor `jest.config.base.ts` sets `forceExit`, `detectOpenHandles`, or `openHandlesTimeout`. Jest is **not** intentionally force-exiting via config; remaining handles cause the runner to hang and then force-exit / warn (as observed in the full review).
   - Jest version: `^30.4.2`.

2. **Four integration suites** (all soft-probe + early-return when infra missing — policy owned by **P2-17**, not this issue):

   | File | Probe | Client lifecycle today |
   | --- | --- | --- |
   | `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | `isRedisAvailable()` | Probe: ioredis `lazyConnect` + `quit()` on success **and** failure. Suite: `beforeEach` creates Redis (`maxRetriesPerRequest: null`); `afterEach` `del` + `quit()` only when `redisAvailable`. |
   | `apps/worker/src/processors/email.processor.int-spec.ts` | `isRedisAvailable()` | Same probe pattern; suite `afterEach` deletes `job-execution:*` keys then `quit()` when available. |
   | `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | `isPostgresAvailable()` | Probe: `pg.Pool` + `pool.end()` on success/failure. Suite: `beforeEach` creates Pool; `afterEach` `pool.end()` when available. |
   | `apps/migrations/src/run-migrations.int-spec.ts` | `isPostgresAvailable()` | Same probe; per-test pools/`runMigrations()` end their own pools in `finally`. |

3. **Contrast with production Redis startup probe** (`libs/infrastructure/src/redis/assert-redis-available.ts` → `assertRedisAvailable`):
   - Sets `retryStrategy: () => null`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`.
   - Registers a no-op `'error'` listener.
   - On failure uses `client.disconnect()` (does not wait for Redis), not `quit()`.
   - Int-spec Redis probes do **none** of the above on the failure path — they call `quit()` after a failed connect with default reconnect behavior. That matches the review observation of force-exit / open handles even when Redis/Postgres were unavailable on localhost (`postgres=False`, `redis=False`).

4. **Connected-path heartbeats** in production adapters used by int-specs (`EmailProcessor`, `DrizzleOutboxProcessor`, `RedisIdempotencyService`) already `unref()` intervals and `clearInterval` in `finally`. They are unlikely primary skip-path leaks, but connected-path Redis/Pool teardown must still be verified with `--detectOpenHandles` when infra is up (AC-02).

## Confirmed root cause

Integration suites leave Node open handles after Jest finishes, so the process does not exit cleanly and Jest force-exits / warns. The strongest code-level cause still present is the **Redis availability probes**: they create ioredis clients without disabling reconnect / offline queue, and use `quit()` on the unavailable path instead of the fail-safe `disconnect()` pattern already proven in `assertRedisAvailable`. Secondary risk: incomplete suite teardown of Redis/`pg.Pool` on connected paths, or probe `Pool` edge cases — confirm with `--detectOpenHandles` during implementation; do not assume production adapter leaks without that evidence (AC-03).

## Dependency/runtime flow

```text
npm run test:int
  -> jest --config jest.integration.config.ts
  -> **/*.int-spec.ts
  -> beforeAll: isRedisAvailable / isPostgresAvailable
       Redis probe (today): new Redis({ lazyConnect, default retryStrategy })
         success -> quit()
         failure -> quit()   // can leave reconnect / socket timers
       Postgres probe: new Pool(...) -> query -> pool.end()
  -> (if available) beforeEach create Redis/Pool
  -> it(...)
  -> afterEach quit()/pool.end() when available flag true
  -> Jest waits for open handles -> warn / force-exit
```

Desired:

```text
probes and suite hooks always fully release clients
  -> Jest exits 0 with no force-exit / open-handle hang under normal conditions
```

No Nest composition roots, HTTP contracts, or production DI tokens are required for the default fix path.

## Goal

Make `npm run test:int` exit cleanly without Jest force-exit / open-handle hang under normal conditions, with teardown that covers both skipped (infra unavailable) and connected (infra available) paths, without changing production runtime unless `--detectOpenHandles` proves a real adapter leak.

## Scope

1. Identify remaining open handles via `jest --config jest.integration.config.ts --detectOpenHandles` (infra-down and, when available, infra-up).
2. Harden Redis (and if needed Postgres) **test-only** availability probes so failure and success paths leave no timers/sockets (align with `assertRedisAvailable` teardown semantics: `retryStrategy: () => null`, `enableOfflineQueue: false`, error listener, `disconnect()` on failure, `quit()`/`disconnect()` on success).
3. Ensure suite `afterEach` / `afterAll` always close Redis clients / `pg.Pool` instances created for connected tests (including failed tests and early returns); use `try/finally` where cleanup can currently be skipped.
4. Prefer a **shared test-only helper** under `test/integration/` for probe + teardown so all four int-specs stay consistent (coordinate with P2-17 — see Open questions). If P2-17’s helper already lands first, harden that helper instead of duplicating probes.
5. Do **not** “fix” the symptom by setting `forceExit: true` in Jest config.
6. Document briefly in `AGENTS.md` / README only if needed to note that `test:int` should be audited with `--detectOpenHandles` when changing int-spec lifecycle (optional; skip if existing notes suffice).

## Out of scope

- P2-17 fail-closed / soft-skip policy for missing PostgreSQL/Redis (separate plan; may share a helper file).
- P2-16 CronModule ioredis mock / `test:module`.
- P2-23 CI workflow wiring.
- Changing production Redis/BullMQ reconnect policy, Nest module lifecycle, or outbox/email heartbeat logic unless `--detectOpenHandles` attributes the leak to those adapters with evidence (then stop and request a plan revision before expanding).
- Adding new integration scenarios or changing assertion semantics of existing int-specs.
- OpenAPI / Postman updates (**N/A** — no HTTP endpoint or public API contract changes).

## Files to create

| Path | Responsibility |
| --- | --- |
| `test/integration/infra-availability.ts` (preferred if P2-17 has not created it yet; otherwise extend the existing helper) | Test-only Redis/Postgres probe helpers that **never leak handles**: Redis options mirror `assertRedisAvailable` (no retry, no offline queue, error listener; `quit` on success, `disconnect` on failure); Postgres `Pool` with short `connectionTimeoutMillis`, always `pool.end()` in `finally`. Export boolean probes and/or assert helpers without owning P2-17’s fail-closed policy unless that plan already merged the same file. |

If the implementer chooses in-place edits only (no shared helper), skip this create and document why in the implementation report; shared helper is still the preferred minimal-duplication approach.

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | Replace/harden `isRedisAvailable`; ensure `afterEach` always closes `redisClient` when created (try/finally); no change to `RedisCacheGateway` production code. |
| `apps/worker/src/processors/email.processor.int-spec.ts` | Same for `isRedisAvailable` / `redisClient` teardown around `EmailProcessor` suite. |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | Harden `isPostgresAvailable` if detectOpenHandles shows Pool leak; ensure `afterEach` always `pool.end()` when pool was created. |
| `apps/migrations/src/run-migrations.int-spec.ts` | Same probe/teardown hardening for migration int-spec pools. |
| `jest.integration.config.ts` | Optional comment only: do **not** enable `forceExit`; may document `--detectOpenHandles` for lifecycle audits. No `forceExit: true`. |
| `docs/agent-plans/INDEX.md` | Register this plan row (planner update). |
| `AGENTS.md` / `README.md` | Optional one-line note under `test:int` that open-handle audits use `--detectOpenHandles`; only if current docs lack any lifecycle guidance. |

## Files to delete

None.

## Contract and DI changes

None. No ports, tokens, Nest providers, composition roots, OpenAPI schemas, or Postman collection items change.

**HTTP / OpenAPI / Postman:** N/A — this issue is Jest open-handle / force-exit lifecycle for `*.int-spec.ts` only.

## Implementation steps

1. Reproduce: run `npm run test:int` and capture whether Jest reports open handles / force-exit (infra-down is sufficient to validate skip-path leaks; also run with infra-up when available).
2. Run `node node_modules/jest/bin/jest.js --config jest.integration.config.ts --detectOpenHandles` and record the reported handle owners (ioredis timers, TCP sockets, `pg` clients, etc.).
3. Introduce or reuse `test/integration/infra-availability.ts` with leak-free Redis/Postgres probes (mirror `assertRedisAvailable` failure teardown; do not import production Nest modules into the helper).
4. Point all four int-specs at the shared probes (or apply the same options/teardown inline if helper is deferred pending P2-17 — avoid conflicting duplicate APIs).
5. Wrap suite Redis/`Pool` cleanup in `afterEach`/`afterAll` with `try/finally` so cleanup runs even when assertions throw; never leave a created client without close.
6. Re-run `--detectOpenHandles` until no leak remains for the exercised path(s).
7. Confirm `npm run test:int` exits promptly with code 0 and **without** force-exit / open-handle hang under normal conditions (AC-01).
8. If detectOpenHandles attributes a leak to production adapter code, **stop** and request a plan revision with evidence before editing production (AC-03).

## Migration and rollout concerns

- Test-only change; no DB migrations, env schema, or deploy order impact.
- Compatible with soft-skip today and with P2-17 fail-closed later: probe teardown must remain correct either way.
- Do not enable `forceExit` in CI as a substitute for closing handles.

## Targeted verification

```bash
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --detectOpenHandles
npm run test:int
```

Optional focused runs:

```bash
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --detectOpenHandles libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --detectOpenHandles apps/worker/src/processors/email.processor.int-spec.ts
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --detectOpenHandles libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --detectOpenHandles apps/migrations/src/run-migrations.int-spec.ts
```

Record: command, result (exit code + whether force-exit/open-handle messages appear), conclusion for skip path and connected path separately when infra availability differs.

## Full verification

```bash
npm run test:int
npm run test:unit
npm run lint
```

`npm run build` is **not** required if only test helpers / int-specs / docs change. Run `npm run build` only if an approved plan revision adds production adapter fixes.

No OpenAPI drift or Postman coverage commands (N/A).

## Acceptance criteria

- **AC-01:** `npm run test:int` no longer requires Jest force-exit under normal conditions (process exits cleanly; no open-handle hang / force-exit warning for the exercised path).
- **AC-02:** Teardown covers both skipped (infra unavailable probes) and connected (suite Redis/`Pool` lifecycle) paths; verified with `--detectOpenHandles` evidence for each path that can be exercised in the environment.
- **AC-03:** No production runtime change unless a real adapter leak is found and fixed with `--detectOpenHandles` evidence (and plan revised if that expands beyond test-only scope).
- **AC-04:** Jest config does **not** gain `forceExit: true` as the remediation.
- **AC-05:** HTTP / OpenAPI / Postman unchanged (N/A confirmed).

## Risks

- **Ordering with P2-17:** both plans touch the same four int-specs and ideally the same helper; implement sequentially or land shared probe teardown first to avoid merge thrash.
- **Infra-up verification gap:** if PostgreSQL/Redis are unavailable in the implementer environment, connected-path AC-02 can only be partially proven; report that explicitly and prefer a follow-up run when infra is present.
- **False confidence from `unref()`:** heartbeats may not keep the process alive but other sockets/timers still can; rely on `--detectOpenHandles`, not on `unref` alone.
- **ioredis version quirks:** success-path `quit()` vs `disconnect()` may still need adjustment if detectOpenHandles shows leftover handles after quit.

## Rollback strategy

Revert the int-spec / test-helper / docs commits. No production rollback. Do not leave `forceExit: true` behind as a permanent setting.

## Open questions requiring human decision

1. **Shared helper vs wait for P2-17:** Prefer creating/hardening `test/integration/infra-availability.ts` in this fix even if P2-17 is still `proposed`, or defer the shared file until P2-17 is approved/implemented and only patch probes in-place here?
2. **Connected-path gate:** Is AC-02 fully required before human acceptance when local PostgreSQL/Redis are unavailable (document residual risk), or must verification wait for an infra-up run?
3. **Production leak expansion:** If `--detectOpenHandles` points at a production adapter, approve a same-issue plan revision for that adapter, or open a new backlog ID?
