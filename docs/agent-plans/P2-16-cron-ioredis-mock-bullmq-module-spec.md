---
issue_id: P2-16
status: approved
owner: human-approval-required
---

# P2-16 — Fix CronModule ioredis mock so `test:module` passes with BullMQ

## Source issue

- Backlog index: `docs/agent-backlog/INDEX.md` — `P2-16` (Medium, Confirmed defect)
- Full issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-16
- Review evidence: `docs/agent-reports/full-review-2026-08-02.md` (CronModule / BullMQ / `ioredis` mock)

**Issue validity:** still valid on the current branch.

## Current behavior

- `apps/cron/src/cron.module.spec.ts` registers:

```ts
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
);
```

- That factory returns a **constructor function** as the module export itself (no CJS `.default`, no `__esModule: true`).
- `CronModule` (`apps/cron/src/cron.module.ts`) imports `InfrastructureBullMqModule.forRootAsync` **and** `InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX], …)`.
- Nest BullMQ queue bootstrap reaches BullMQ `RedisConnection.init()` which does `new require('ioredis').default(...)` (`bullmq@5.80.9` → `node_modules/bullmq/dist/cjs/classes/redis-connection.js`).
- Under the current mock, `ioredis_1.default` is not a constructor → `TypeError: ioredis_1.default is not a constructor` while compiling/initializing the Cron module-spec.
- Same shallow mock pattern exists in:
  - `apps/api/src/composition/auth-application.module.spec.ts` (RedisModule only; **no** BullMQ queue registration)
  - `libs/infrastructure/src/redis/redis.module.spec.ts` (RedisModule only)
- Those Redis-only specs can still work because compiled `import Redis from 'ioredis'` often resolves the mock function as the callable default, whereas BullMQ’s CJS path requires `.default` explicitly.
- `libs/infrastructure/src/bullmq/bullmq.module.spec.ts` does **not** mock `ioredis` and only asserts `registerQueues` metadata (no Nest `Test.createTestingModule` / Queue connect).

**Planner note:** live `npm run test:module` was not re-executed in this planning session (tool auto-review blocked the command). Validity is confirmed from current source + BullMQ CJS usage + the recorded full-review failure. The implementer must capture fresh command evidence.

## Confirmed root cause

BullMQ constructs Redis via `new (require('ioredis').default)(...)`. The Cron module-spec `jest.mock('ioredis')` does not expose a CJS-compatible `{ default: RedisMock }` (with `__esModule: true`), so Queue bootstrap fails during the DI/module gate even without a real Redis server.

A correct `.default` export alone may be insufficient: after construction, BullMQ `RedisConnection.init()` also expects a usable client surface (`status`, `on`, `info()`, `defineCommand`, and close via `quit`/`disconnect`). The implementer must extend the mock until Cron bootstrap + `moduleRef.close()` succeed under `test:module`.

## Dependency/runtime flow

```text
apps/cron/src/cron.module.spec.ts
  jest.mock('ioredis')  // current: bare jest.fn() export
  Test.createTestingModule({ imports: [CronModule] }).compile() / .init() / .close()
    └─► CronModule
          ├─ RedisModule.forRootAsync → new Redis(...) via ESM interop (often tolerates bare fn)
          └─ InfrastructureBullMqModule.registerQueues([OUTBOX])
                └─ BullModule.registerQueue
                      └─ BullMQ Queue → RedisConnection.init()
                            └─ new require('ioredis').default(opts)  // FAIL today
                                  then: client.on(...); waitUntilReady (skip if status==='ready');
                                        client.info(); client.defineCommand(...);
                                        on close: client.quit() / disconnect()
```

## Goal

Make `CronModule`’s module-spec compatible with BullMQ’s CJS `ioredis` consumption so `npm run test:module` is green, without changing production Cron/BullMQ/Redis runtime behavior.

## Scope

1. Fix `jest.mock('ioredis')` in `apps/cron/src/cron.module.spec.ts` to export a CJS/ESM-interop shape BullMQ accepts: `{ __esModule: true, default: RedisMock }`.
2. Expand the Redis mock instance with the minimum methods/properties BullMQ needs for construct → ready → version check → close (at least: `on`, `status: 'ready'`, `info` returning a string containing `redis_version:` ≥ BullMQ `minimumVersion` (`5.0.0`; prefer `6.2.0` to avoid recommended-version warn), `defineCommand`, `connect`, `quit`, `disconnect`; add further stubs only if the suite still fails).
3. Re-run `npm run test:module` until exit 0; confirm Cron suite passes and the prior `ioredis_1.default is not a constructor` error is gone.
4. Spot-check other `*.module.spec.ts` that mock `ioredis` (auth-application, redis.module) still pass under the same gate — **do not change them unless they fail after the Cron fix or the human chooses the shared-helper option below**.

## Out of scope

- Production changes under `apps/cron/src/cron.module.ts`, `libs/infrastructure/**` BullMQ/Redis adapters, Worker/API entrypoints.
- Reworking Cron composition (removing BullMQ from Cron, swapping Queue providers, or overriding BullMQ connection factories in the test as an alternative design).
- Changing `auth-application.module.spec.ts` / `redis.module.spec.ts` solely for style consistency (unless they fail or shared helper is approved).
- Integration tests (`*.int-spec.ts`), open-handle / `forceExit` work (P3-09), CI workflow addition (P2-23), BullMQ key prefix (P2-20).
- HTTP/OpenAPI/Postman (no endpoint changes).
- Marking P2-16 resolved in the backlog (verification + human acceptance only).

## Files to create

- None required for the default (inline) fix.

- **Optional (only if human chooses shared helper):** a small Jest helper module used by BullMQ-heavy specs, e.g. `test/mocks/ioredis.mock.ts` (exact path to be chosen by implementer to match existing Jest roots/`moduleNameMapper` if any). Prefer **not** creating this unless reusing across specs is approved — there is currently no shared test-mock package in the repo.

## Files to modify

| Path | Symbol / responsibility |
| --- | --- |
| `apps/cron/src/cron.module.spec.ts` | `jest.mock('ioredis', …)` — export `{ __esModule: true, default: RedisMock }` and flesh out mock client methods used by BullMQ construct/close; keep existing `CronModule` assertions (`OutboxSchedule`, `TOKENS.OutboxProcessorOptions`, no `DRIZZLE_DB`). |
| `docs/agent-plans/INDEX.md` | Index row for this plan (planner maintenance only; not a production change). |

**Conditional (only if shared helper approved or sibling specs fail):**

| Path | Symbol / responsibility |
| --- | --- |
| Shared mock helper (new path TBD) | Export reusable `createIoredisJestMockModule()` / `RedisMock` factory. |
| `apps/api/src/composition/auth-application.module.spec.ts` | Switch to shared helper **only if** approved or required for green `test:module`. |
| `libs/infrastructure/src/redis/redis.module.spec.ts` | Same conditional update. |

## Files to delete

- None.

## Contract and DI changes

- **None.** No contracts, tokens, providers, or composition-root production registrations change.
- Test-only mock shape change; RedisModule / InfrastructureBullMqModule production wiring stays as-is.

## Implementation steps

1. In `apps/cron/src/cron.module.spec.ts`, replace the current `jest.mock('ioredis')` factory with an object export:
   - `RedisMock = jest.fn().mockImplementation(() => ({ ... }))`
   - `return { __esModule: true, default: RedisMock }`
2. On each mock instance, provide at least:
   - `on: jest.fn()` (and `off` / `removeListener` if BullMQ detach paths require them)
   - `status: 'ready'` so `RedisConnection.waitUntilReady` returns immediately
   - `info: jest.fn().mockResolvedValue('redis_version:6.2.0\r\n')` (or equivalent multi-line INFO blob)
   - `defineCommand: jest.fn()` for `loadCommands`
   - `connect: jest.fn().mockResolvedValue(undefined)`
   - `quit: jest.fn().mockResolvedValue('OK')`
   - `disconnect: jest.fn()`
3. Keep the existing two tests and env helper (`withTestEnv` / `TEST_ENV`) unchanged unless a missing env key is proven necessary for Compiling CronModule after the mock fix.
4. Run targeted Cron module-spec, then full `npm run test:module`.
5. If failures remain after `.default` is fixed, iteratively add only the stub methods named in the stack trace (do not invent broad Redis facades).
6. If the human approved a shared helper instead of inline-only: extract the mock factory and point Cron (and only failing siblings) at it; otherwise leave sibling specs alone when still green.
7. Do not edit production Cron/BullMQ/Redis code for this issue.

## Migration and rollout concerns

- None. Test-only change; no DB migrations, env schema, deploy order, or runtime config impact.

## Targeted verification

| Command | Expected |
| --- | --- |
| `npm run test:module -- --testPathPattern=cron.module.spec` | Exit 0; both CronModule examples pass |
| Inspect failure output if any | Must not include `ioredis_1.default is not a constructor` |

## Full verification

| Command | Expected |
| --- | --- |
| `npm run test:module` | Exit 0; all `*.module.spec.ts` suites pass (including Cron) |
| Spot-check: auth-application + redis module specs still listed as passed | No regression from Cron-only mock change |

Not required for this issue (no production code / no HTTP): `npm run build`, `npm run lint`, OpenAPI drift, Postman coverage, `test:int`.

## Acceptance criteria

- **AC-01:** `npm run test:module` exits 0 with the `CronModule` suite passing.
- **AC-02:** Failure mode `ioredis_1.default is not a constructor` no longer appears for CronModule bootstrap.
- **AC-03:** No production Cron/BullMQ/Redis behavior change is introduced solely for this fix (diff limited to test mock / optional test helper + plan index).

## Risks

- **Secondary mock gaps:** fixing `.default` may surface the next BullMQ client call (`info`, `defineCommand`, event API). Mitigate by running the suite and stubbing only what fails.
- **Hang risk:** if `status` is not `'ready'`/`'wait'` handled correctly, `waitUntilReady` can hang until Jest timeout. Prefer `status: 'ready'`.
- **Sibling mock drift:** leaving auth/redis specs on the old shape is fine today; a future BullMQ bootstrap in those suites could regress. Shared helper is optional hardening, not required for AC.
- **Planner did not re-run `test:module`:** implementer evidence is mandatory before verification `approved`.

## Rollback strategy

- Revert the change to `apps/cron/src/cron.module.spec.ts` (and delete any optional shared helper + call-site updates). No production rollback needed.

## Open questions requiring human decision

1. **Shared helper vs inline-only (default):** Prefer the minimal inline fix in `apps/cron/src/cron.module.spec.ts` only. Approve extracting a shared `ioredis` Jest mock helper and updating sibling specs only if you want proactive consistency.
2. **Alternate design (not recommended):** Instead of fixing the mock, override BullMQ/Nest Queue providers in the Cron spec so Queue never constructs Redis. This avoids deepening Redis stubs but diverges from the backlog’s stated required change and weakens the “composition root compiles” signal. Default plan assumes mock-shape fix unless you reject it.
