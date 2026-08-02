---
issue_id: P2-17
status: approved
owner: human-approval-required
---

# P2-17 — Fail-closed or explicit-skip when integration tests lack PostgreSQL

## Source issue

- Backlog ID: `P2-17`
- Index: `docs/agent-backlog/INDEX.md`
- Full issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § "P2-17. Fail-closed or explicit-skip when integration tests lack PostgreSQL"
- Source review: `docs/agent-reports/full-review-2026-08-02.md` (Medium — silent green skip on missing PostgreSQL)

## Current behavior

`npm run test:int` runs Jest with `jest.integration.config.ts` (`testMatch: ['**/*.int-spec.ts']`). Four suites exist:

| File | Infra probe | Soft-skip pattern |
| --- | --- | --- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | `isPostgresAvailable()` | `console.warn` in `beforeAll`; `if (!postgresAvailable) return` in hooks and each `it` |
| `apps/migrations/src/run-migrations.int-spec.ts` | `isPostgresAvailable()` | silent early `return` inside each `it` (no warn) |
| `apps/worker/src/processors/email.processor.int-spec.ts` | `isRedisAvailable()` | same soft-skip as outbox (Redis) |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | `isRedisAvailable()` | same soft-skip as outbox (Redis) |

When PostgreSQL/Redis are unreachable, each `it` exits without assertions. Jest still counts those cases as **passed**. Review evidence: `test:int` → 4 suites / 8 tests passed with `postgres=False` on localhost.

`AGENTS.md` and `README.md` already say `test:int` requires PostgreSQL and Redis, but they do not state that missing infra must not produce a green gate that looks like verified DB/Redis behavior.

## Confirmed root cause

Availability probes soft-skip assertions (`early return` / warn-only) without `describe.skip`, `fail()`, thrown errors, or a non-zero policy wrapper. The integration gate cannot distinguish “infra missing” from “behavior verified”.

Still present on the current branch (static inspection of all four `*.int-spec.ts` files; no shared fail-closed helper or Jest skip/fail policy exists).

## Dependency/runtime flow

```text
npm run test:int
  -> jest --config jest.integration.config.ts
  -> **/*.int-spec.ts
  -> per-file isPostgresAvailable / isRedisAvailable (pg Pool or ioredis)
  -> today: warn + return => Jest green
  -> desired: fail-closed (default) so missing infra => non-zero exit / failed suite
```

No production Nest modules, DI tokens, HTTP contracts, or migrations are involved.

## Goal

Make `test:int` an honest integration gate: without the required PostgreSQL (and, for consistency, Redis) service, the suite must not report success that implies outbox/migration/Redis asserts ran; with services up, existing asserts must still execute.

## Scope

1. Adopt **fail-closed by default** for all `*.int-spec.ts` availability probes (recommended policy; see Open questions for the alternate skip+wrapper policy).
2. Replace soft-skip early returns with a suite-level failure when required infra is unavailable.
3. Deduplicate repeated probe helpers into one test-only module used by all four int-specs.
4. Document the policy in `AGENTS.md` and the README test-script section so agents/operators know `test:int` is not optional-green when infra is down.
5. Keep existing outbox lease/heartbeat, migration lock, email idempotency, and cache pattern assertions unchanged when infra is available.

## Out of scope

- P2-16 (CronModule ioredis mock / `test:module`).
- P3-09 (open-handle leak / Jest force-exit on `test:int`).
- P2-23 (adding CI workflows) — documenting how CI should interpret `test:int` is in scope; wiring a new workflow is not.
- Changing production outbox/migration/cache/email runtime code.
- Adding new integration scenarios beyond the availability policy.
- OpenAPI / Postman updates (N/A — no HTTP endpoint changes).

## Files to create

| Path | Responsibility |
| --- | --- |
| `test/integration/infra-availability.ts` | Shared test-only helpers: `assertPostgresAvailable(databaseUrl?)` and `assertRedisAvailable(opts?)` (or `probe*` + `require*` pair). On failure, throw a clear `Error` stating that `npm run test:int` requires the service and must not soft-pass. Reuse current connection defaults (`DATABASE_URL` / Redis host-port-db-password env) and short connect timeouts (~2s). |

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` | Remove local `isPostgresAvailable`; in `beforeAll` call shared assert; delete `postgresAvailable` soft-skip branches in `beforeEach` / `afterEach` / both `it` bodies so asserts always run when the suite starts. |
| `apps/migrations/src/run-migrations.int-spec.ts` | Same for `isPostgresAvailable` / `postgresAvailable` early returns in all three `it` blocks. |
| `apps/worker/src/processors/email.processor.int-spec.ts` | Same for Redis: remove local `isRedisAvailable` soft-skip; fail-closed in `beforeAll`. |
| `libs/infrastructure/src/cache/redis-cache.gateway.int-spec.ts` | Same Redis fail-closed change. |
| `jest.integration.config.ts` | Ensure the new helper is resolvable (path mapping or relative imports from int-specs). Optionally add a short comment that `test:int` is fail-closed on missing infra. No production app code. |
| `AGENTS.md` | Under the `test:int` / suite-split notes: state explicitly that missing PostgreSQL or Redis must fail the suite (non-zero / failed tests), and that a green `test:int` means asserts against live infra ran. |
| `README.md` | In the test-script / §26-style notes around `test:int`: mirror the same fail-closed policy (Ukrainian section may keep language consistency with surrounding prose). |
| `docs/agent-plans/INDEX.md` | Register this plan row while `proposed` / through approval lifecycle. |

## Files to delete

None. (Local duplicate probe functions are removed from int-specs as edits, not separate file deletions.)

## Contract and DI changes

None. No ports, tokens, Nest providers, composition roots, OpenAPI schemas, or Postman collection items change.

**HTTP / OpenAPI / Postman:** N/A.

## Implementation steps

1. **Confirm baseline:** Run `npm run test:int` without PostgreSQL/Redis if possible and record that suites currently pass via soft-skip (or document infra-up baseline if services are present).
2. **Add** `test/integration/infra-availability.ts` with fail-closed asserts (clear error message naming the missing service and `DATABASE_URL` / Redis target).
3. **Wire Jest:** Prefer relative imports from each int-spec to `test/integration/infra-availability.ts`, or add a `moduleNameMapper` entry in `jest.integration.config.ts` only if relative paths are awkward. Do not put the helper in `libs/domain` / production packages.
4. **Outbox int-spec:** `beforeAll` → `await assertPostgresAvailable()`; remove all soft-skip returns; keep lease/heartbeat test bodies intact.
5. **Migrations int-spec:** same Postgres fail-closed change for all three tests.
6. **Email + Redis cache int-specs:** same Redis fail-closed change (required for consistent gate behavior; issue “Required change #2”).
7. **Docs:** Update `AGENTS.md` and `README.md` policy text; note that `test:all` still excludes `test:int`, and that agents must treat missing infra failure as infrastructure unavailability, not as a product defect—but must not claim integration verification from a skipped/green soft path.
8. **Do not** introduce `INTEGRATION_ALLOW_SKIP` soft-green mode unless humans choose the alternate policy in Open questions.

## Migration and rollout concerns

- No database migrations.
- Local/CI developers who previously ran `test:int` without Compose Postgres/Redis will see **failing** suites instead of silent green — intentional.
- Operators should run `docker compose up -d postgres redis` (and migrations as already documented) before `test:int`.
- No production runtime rollout impact.

## Targeted verification

| Command | Expected | Maps to |
| --- | --- | --- |
| Static review of all `*.int-spec.ts` | No soft-skip `return` on missing infra; shared assert used | AC-01, consistency |
| `npm run test:int` with PostgreSQL **and** Redis **stopped**/unreachable | Non-zero exit; failed suites; no “8 passed” soft-green | AC-01 |
| `npm run test:int` with PostgreSQL + Redis up (and schema/`outbox_events` available as today) | Outbox lease/heartbeat tests execute real asserts; migrations/email/cache int tests run | AC-02 |
| Grep/docs check of `AGENTS.md` + `README.md` | Fail-closed / interpretation policy stated | AC-03 |

## Full verification

| Command | Expected | Notes |
| --- | --- | --- |
| `npm run test:int` (infra up) | Pass | Primary gate for this issue |
| `npm run test:int` (infra down) | Fail | Proof of AC-01 |
| `npm run lint` | Pass | Touches TS test helpers + docs only; still run after TS edits |
| `npm run test:unit` | Pass / unchanged | Sanity that unit gate unaffected |
| `npm run build` | Not required for test-only/docs change; optional if implementer touches shared Jest config types | |

Do **not** require `start:api` / live entrypoint bootstrap to prove this issue.

## Acceptance criteria

- **AC-01:** Running `test:int` without PostgreSQL cannot report a fully green suite that implies outbox DB asserts ran. *(Verify: infra-down `npm run test:int` non-zero / failed.)*
- **AC-02:** When PostgreSQL is available, existing outbox lease/heartbeat asserts still run. *(Verify: infra-up `npm run test:int` executes outbox int-spec bodies successfully.)*
- **AC-03:** Docs state the chosen skip/fail policy for operators and agents. *(Verify: `AGENTS.md` + `README.md` updated.)*

Implied by Required change #2 (same change set): Redis-probing int-specs must use the same fail-closed policy so the overall `test:int` gate is consistent.

## Risks

- Developers habitually running `test:int` without Docker will see new failures (mitigation: docs + clear error text).
- Outbox probe currently requires `SELECT 1 FROM outbox_events` (table must exist); fail-closed will surface “Postgres up but migrations missing” as failure too — acceptable and clearer than soft-pass.
- Shared helper import path mistakes could break Jest resolution on Windows (mitigation: relative path from each suite or explicit `moduleNameMapper`).
- Alternate human preference for `describe.skip` + custom non-zero wrapper would change implementation shape (see Open questions).

## Rollback strategy

Revert the plan’s commits (helper + int-spec edits + doc lines). Behavior returns to soft-skip green; no migration or data rollback needed.

## Open questions requiring human decision

1. **Policy choice (blocking for implementer if rejected):** This plan recommends **fail-closed** (throw / fail in `beforeAll` when Postgres or Redis is unavailable). The backlog also allows `describe.skip` plus a dedicated non-success summary/wrapper when an env like `INTEGRATION=1` is set. Approve fail-closed, or require the skip+wrapper variant instead?
2. **Redis in the same change set:** Required change #2 says apply to all probing `*.int-spec.ts` (includes Redis). Confirm Redis fail-closed is in scope for P2-17 (recommended: yes). If humans want Postgres-only, say so before implementation.
3. **Optional escape hatch:** Should an explicit opt-in env (e.g. `INTEGRATION_ALLOW_SKIP=1`) re-enable soft skips for local exploration? Default in this plan: **no** (keeps the gate honest). Approve “no hatch”, or request one?
