# P2-04 — Independent verification

## Verdict

**approved**

## Scope checked

Verified against `git diff`, `git status`, direct file inspection, and independent command execution. Production changes match the approved plan and are confined to Outbox timeout completion-guard behavior:

| File                                                                  | Status   | Plan alignment                                                        |
| --------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`          | Modified | `publishEventWithTimeout()` — timeout flag + await handler settlement |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts`     | Modified | Unit cases A/B/C + `handlerTimeoutMs=0` regression                    |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | Modified | V-09 integration scenario                                             |
| `README.md`                                                           | Modified | §5.13 completion-guard semantics and at-least-once wording            |
| `.env.example`                                                        | Modified | Comment under `OUTBOX_HANDLER_TIMEOUT_MS`                             |

**Not modified (confirmed):** `libs/contracts/**` (empty diff), `IOutboxProcessor`, `OutboxProcessorOptions`, `IDomainEventRouter`, `IDomainEventHandler`, Worker/Cron composition roots, env schema, migrations.

**Staged but out of P2-04 production scope:** `docs/agent-reports/P2-03-verification.md`, `docs/agent-reports/P2-04-implementation.md` — documentation only; no unrelated production refactor observed in the diff.

## Root-cause assessment

**Root cause addressed — not symptom suppression.**

Original defect: `publishEventWithTimeout()` used `Promise.race` with a rejecting timeout side. On timeout, `processPending()` immediately reached `markFailed()`, clearing `lockedAt`/`lockedBy` while `publishEvent()` → `route()` continued as an orphaned promise, allowing concurrent reclaim (V-09).

Fix: a single `publishPromise` is started; when `handlerTimeoutMs > 0`, a non-rejecting timeout sets `handlerTimedOut` and logs `warn`. If the timeout wins the race, the code **awaits `publishPromise` to settlement** before throwing the timeout error. `processPending()` therefore does not reach `markFailed()` or the `finally` heartbeat clear until the handler finishes.

```209:245:libs/infrastructure/src/outbox/drizzle-outbox-processor.ts
  private async publishEventWithTimeout(event: OutboxRow): Promise<void> {
    const publishPromise = this.publishEvent(event);

    if (this.options.handlerTimeoutMs <= 0) {
      await publishPromise;
      return;
    }

    let handlerTimedOut = false;
    // ...
    try {
      await Promise.race([publishPromise, timeoutPromise]);

      if (handlerTimedOut) {
        await publishPromise.catch(() => undefined);

        throw new Error(`Outbox handler timeout after ${this.options.handlerTimeoutMs}ms`);
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
```

Timeout semantics after fix: failure is recorded only after settlement; heartbeat in `processPending()` continues until `publishEventWithTimeout()` returns on the timeout path.

## Acceptance criteria matrix

| #   | Criterion                                                                           | Status      | Evidence                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Slow `route()` exceeding timeout does not release lock until settlement             | **Passed**  | Unit test `defers markFailed until slow handler settles after timeout (P2-04)`: `markFailedAtMs` undefined at 1000 ms, defined only after 3000 ms; `route` called once.                                                           |
| 2   | Second worker cannot reclaim while first handler still running after timeout (V-09) | **Passed**  | Integration test `prevents reclaim while timed-out handler is still running (V-09 / P2-04)`: at 2500 ms, Processor B `claimPendingBatch()` does not return event id.                                                              |
| 3   | `route()` invoked at most once concurrently per timeout cycle                       | **Passed**  | V-09 int test: `routeCount.value === 1` before and after Processor A completes.                                                                                                                                                   |
| 4   | Handler within timeout → `markProcessed()`                                          | **Passed**  | Unit test `marks processed when handler completes within timeout (P2-04)`: `processed=1`, `failed=0`.                                                                                                                             |
| 5   | Handler exceeding timeout → failed/retried, never processed even if later resolves  | **Passed**  | Unit test `does not mark processed when handler resolves after timeout (P2-04)`: `processed=0`, `failed=1`, timeout warn logged; int test asserts `status !== 'processed'`.                                                       |
| 6   | `handlerTimeoutMs = 0` behavior unchanged                                           | **Passed**  | Unit test `with handlerTimeoutMs disabled, slow route still holds ownership via heartbeat (P2-04 regression)`: success path unchanged.                                                                                            |
| 7   | README documents completion-guard semantics; no exactly-once claim                  | **Passed**  | README §5.13 `handlerTimeoutMs` bullet and delivery-semantics paragraph updated per plan.                                                                                                                                         |
| 8   | No contract changes to `IOutboxProcessor`, router, or handlers                      | **Passed**  | `git diff HEAD -- libs/contracts/` empty.                                                                                                                                                                                         |
| 9   | `npm run build` and `npm run lint` pass                                             | **Partial** | `npm run build` passes. Full `npm run lint` fails on 4 pre-existing errors in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (P2-11 scope, not in P2-04 diff). P2-04 changed files pass targeted eslint. |

## Dependency and DI verification

DI chain unchanged from approved plan:

```text
Worker/Cron composition roots
  -> OutboxProcessorModule.forRootAsync({ useFactory: config.outbox() })
       -> DrizzleOutboxProcessor (TOKENS.OutboxProcessor)
       -> DomainEventRouter (TOKENS.DomainEventRouter)
       -> UserRegisteredEventHandler (TOKENS.DomainEventHandlers)
```

No provider, token, or module registration changes in the diff.

## Commands executed

| Command                                                                                                                                                                                                                      | Result                                                                                  | Conclusion                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `npm run test:unit -- drizzle-outbox-processor.spec.ts`                                                                                                                                                                      | Pass — 9 tests                                                                          | All P2-04 unit cases pass independently               |
| `npm run test:int -- drizzle-outbox-processor.int-spec.ts`                                                                                                                                                                   | Pass — 2 tests (PostgreSQL available)                                                   | V-09 scenario passes with runtime evidence            |
| `npm run build`                                                                                                                                                                                                              | Pass                                                                                    | Shared infrastructure change compiles all entrypoints |
| `npx eslint libs/infrastructure/src/outbox/drizzle-outbox-processor.ts libs/infrastructure/src/outbox/drizzle-outbox-processor.spec.ts libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts --max-warnings=0` | Pass                                                                                    | P2-04 changed files lint clean                        |
| `npm run lint`                                                                                                                                                                                                               | Fail — 4 errors in `outbox-processor.defaults.ts`, `outbox-processor.options.schema.ts` | Pre-existing P2-11 lint debt; not introduced by P2-04 |

## Findings

1. **Implementation matches approved plan** — no undocumented deviations; timeout error takes precedence over late handler rejection per plan default.
2. **No orphaned handler promise on timeout path** — `await publishPromise.catch(() => undefined)` ensures settlement before `markFailed()`.
3. **Heartbeat lifecycle preserved** — `processPending()` `finally` clears interval only after `publishEventWithTimeout()` returns; during post-timeout wait, `extendLock` continues.
4. **Full-repo lint gate not green** — failures are outside P2-04 diff and pre-date this fix; they should be resolved under P2-11, not by revisiting P2-04.

## Documentation alignment

- README §5.13 accurately describes completion-guard timeout behavior and retains at-least-once (not exactly-once) wording.
- `.env.example` comment mirrors README guard semantics for `OUTBOX_HANDLER_TIMEOUT_MS`.
- Backlog P2-04 section not marked resolved in this change (per plan).

## Remaining risks

- Handlers that never settle still hold the lease indefinitely (pre-existing; cooperative `AbortSignal` deferred per plan).
- Timed-out events stay locked until handler completes — intended trade-off documented in README.
- Sequential retry after timeout may still duplicate side effects (at-least-once; acceptable per backlog).

## Unverified areas

- Full-repo `npm run lint` green status (blocked by unrelated P2-11 lint debt).
- Full `npm run test:unit` / `npm run test:int` suites not re-run end-to-end; implementer report notes unrelated pre-existing failures in other specs.
- Worker/Cron bootstrap not re-run; no DI wiring changes expected for this localized adapter fix.
