---
issue_id: P3-11
status: approved
owner: human-approval-required
---

# P3-11 — Clarify Compose `db:migrate` vs `db:migrate:prod` advisory lock

## Source issue

- Backlog ID: `P3-11`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-11
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (compact backlog + production-readiness: Compose vs `db:migrate:prod` in ops docs)

## Current behavior

Confirmed on current branch (inspected 2026-08-02):

1. **Local Compose migrations service uses unprotected drizzle-kit migrate:**
   - `docker-compose.yml` `migrations.command` = `npm run db:migrate`
   - `package.json` script `db:migrate` = `drizzle-kit migrate && echo "…"` — **no** Nest migrations entrypoint, **no** `pg_advisory_lock`, **no** lock/statement timeouts
   - No YAML comments on the `migrations` service explaining local-only / no advisory lock

2. **Production Compose uses the advisory-locked entrypoint:**
   - `docker-compose.prod.yml` `migrations.command` = `['npm', 'run', 'start:prod:migrations']`
   - Equivalent npm scripts: `db:migrate:prod` → `start:prod:migrations` → `node dist/apps/migrations/main.js`
   - `apps/migrations/src/run-migrations.ts` → `acquireMigrationAdvisoryLock` / `releaseMigrationAdvisoryLock` (`apps/migrations/src/migration-lock.ts`, keys in `migration-lock.constants.ts`) with bounded timeouts

3. **Docs partially distinguish paths, but not clearly enough next to local Compose:**
   - `README.md` § **3.4. Migrations** correctly separates `db:migrate:prod` / `start:prod:migrations` (advisory lock) from local `db:migrate` (drizzle-kit)
   - `README.md` § **8.2** lists Compose services as `migrations (one-shot: npm run db:migrate)` with **no** “local/dev, no advisory lock” caveat
   - `README.md` § **8.4** recommends `docker compose run --rm migrations` as matching `docker-compose.yml`, then mentions production `db:migrate:prod` separately — does **not** state that the local Compose path lacks advisory lock / must not be used against production
   - `README.md` § **10** one-liner correctly labels `db:migrate` vs `db:migrate:prod`
   - `DOCKER_PRODUCTION.md` correctly describes compiled one-shot + advisory lock for prod Compose, but does not name the **contrast** with local `docker-compose.yml` / `db:migrate`
   - `AGENTS.md` Migrations section describes the advisory-locked entrypoint; Migration commands list both scripts without saying which Compose file uses which
   - `EXAMPLES.md` uses `db:migrate` for local schema workflow only (acceptable for examples; not an ops path)

4. **No code defect:** leaving local Compose on `db:migrate` is intentional per the backlog (“No change to Compose defaults required unless a separate plan…”).

## Confirmed root cause

Operators (and agents) can treat local Compose `migrations` / `npm run db:migrate` as equivalent to the production-safe runner. Ops-facing docs near Compose list `db:migrate` without an explicit **local/dev · no advisory lock** vs **production · `db:migrate:prod` / `start:prod:migrations` · advisory lock** distinction. The mismatch is documentation placement/clarity, not missing lock code on the prod path.

## Dependency/runtime flow

```text
Local / docker-compose.yml
  migrations service
    -> npm run db:migrate
    -> drizzle-kit migrate
    -> NO pg_advisory_lock / NO Nest apps/migrations entrypoint

Production / docker-compose.prod.yml (or npm run db:migrate:prod)
  migrations service / job
    -> npm run start:prod:migrations  (alias: db:migrate:prod)
    -> apps/migrations/src/main.ts
    -> runMigrations()
         -> SET statement_timeout
         -> acquireMigrationAdvisoryLock (pg_advisory_lock + lock_timeout)
         -> drizzle migrator
         -> releaseMigrationAdvisoryLock
```

## Goal

Make ops and Compose-adjacent docs unambiguously separate:

- **Local Compose / `db:migrate`** — drizzle-kit, suitable for local/dev, **no** session advisory lock
- **Production / `db:migrate:prod` / `start:prod:migrations` / `docker-compose.prod.yml`** — compiled migrations entrypoint with advisory lock and bounded timeouts

Do **not** change Compose defaults or migration runtime code in this issue.

## Scope

- Documentation and Compose **comments** only (YAML comments are docs, not runtime behavior).
- Clarify README Compose sections (§8.2 / §8.4) and strengthen cross-links to §3.4 / production ops.
- Clarify `DOCKER_PRODUCTION.md` contrast with local Compose.
- Light `AGENTS.md` clarification on which command/Compose file is which.
- Optional one-liner in `EXAMPLES.md` if needed so local `db:migrate` is not mistaken for production.
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).

## Out of scope

- Other backlog IDs (P2-xx, P3-05…P3-10, P3-12+, TASK-xxx).
- Changing `docker-compose.yml` `command` from `db:migrate` to `db:migrate:prod` / `start:prod:migrations` (explicitly deferred unless a separate approved plan).
- Changing `docker-compose.prod.yml`, `package.json` scripts, or `apps/migrations/**` lock/timeout behavior.
- Switching local Compose image target, adding drizzle-kit to production images, or rewriting §3.4 from scratch.
- HTTP endpoints, OpenAPI, or Postman updates.

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None (plan file + INDEX row are planner artifacts already covered here).

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `docker-compose.yml` | `migrations` service: add concise YAML comments that this is **local/dev**, runs `npm run db:migrate` (drizzle-kit), and does **not** use the production advisory-locked entrypoint; point operators to `docker-compose.prod.yml` + `db:migrate:prod` / `start:prod:migrations` for production. **Do not** change `command`, image, or depends_on. |
| `README.md` | § **8.2. Сервіси**: qualify the migrations line so it is clearly local Compose (`docker-compose.yml`) using `db:migrate` **without** advisory lock; contrast with production Compose / `db:migrate:prod`. § **8.4. Міграції**: after recommending `docker compose run --rm migrations`, state explicitly that this path is local/dev drizzle-kit and must **not** be used against production; keep/strengthen the production block (`build:migrations` + `db:migrate:prod` / prod Compose). Optionally add a one-line pointer back to § **3.4**. Do not invent new scripts. |
| `DOCKER_PRODUCTION.md` | § **Важливо** (migrations bullets ~L48–49): name `start:prod:migrations` / `db:migrate:prod` and contrast with local `docker-compose.yml` / `db:migrate` (no advisory lock). Keep existing advisory-lock concurrency guidance. |
| `AGENTS.md` | Migrations entrypoint bullets and/or Migration commands block: one short sentence that `db:migrate` = local/dev drizzle-kit (Compose `docker-compose.yml`); `db:migrate:prod` / `start:prod:migrations` = production one-shot with advisory lock (`docker-compose.prod.yml`). |
| `EXAMPLES.md` | § **3** migration snippet (~L163–166) and/or table row ~L857: optional one-liner that `db:migrate` is local/dev only; production uses `db:migrate:prod` (link README §3.4 / `DOCKER_PRODUCTION.md`). Recommended include for AC-02. |
| `docs/agent-plans/INDEX.md` | Add row for `P3-11` → this plan while `proposed`. |

## Files to delete

- None.

## Contract and DI changes

- **None.** No tokens, providers, exports, composition roots, or npm script renames.
- Docs must not claim that local Compose `db:migrate` acquires `pg_advisory_lock`.

## Implementation steps

1. Reconfirm baseline (docs-only issue still true):
   - `docker-compose.yml` migrations `command: npm run db:migrate`
   - `docker-compose.prod.yml` migrations `command: ['npm', 'run', 'start:prod:migrations']`
   - `package.json`: `db:migrate` vs `db:migrate:prod` / `start:prod:migrations`
   - `apps/migrations/src/run-migrations.ts` still calls `acquireMigrationAdvisoryLock`
2. Add comments above `migrations` in `docker-compose.yml` (local vs prod; no lock on this path). Leave `command` unchanged.
3. Edit `README.md` §8.2 and §8.4 with explicit local-vs-prod wording; cross-link §3.4 / production Compose as needed.
4. Edit `DOCKER_PRODUCTION.md` important bullets to name both command families and the Compose file distinction.
5. Edit `AGENTS.md` Migrations / Migration commands with the same distinction (one or two sentences).
6. Optionally edit `EXAMPLES.md` local migrate snippet/table with a “local only” caveat + pointer to prod path.
7. Grep for residual ops wording that equates Compose `db:migrate` with the advisory-locked runner; fix only P3-11-scoped locations (do not rewrite unrelated historical review reports).
8. Do **not** change files under `apps/`, `libs/`, `package.json`, `package-lock.json`, or `docker-compose.prod.yml` command.

## Migration and rollout concerns

- Documentation / comment-only; no database migration, env, or runtime rollout impact.
- Local developer workflow (`docker compose up`, `npm run db:migrate`) remains unchanged.
- Production operators who already use `docker-compose.prod.yml` / `db:migrate:prod` are unaffected except clearer docs.
- Risk of someone still running host `db:migrate` against a production `DATABASE_URL` remains an operator error — docs must discourage that (AC-02) but cannot enforce it in this issue.

## Targeted verification

```bash
# Compose defaults unchanged
rg -n "command:.*db:migrate|start:prod:migrations" docker-compose.yml docker-compose.prod.yml

# Docs state local vs prod / advisory lock distinction
rg -n "db:migrate|db:migrate:prod|advisory|drizzle-kit|docker-compose.prod" README.md DOCKER_PRODUCTION.md AGENTS.md docker-compose.yml EXAMPLES.md

# No production/runtime code drift from this issue
git diff --name-only -- apps libs package.json package-lock.json docker-compose.prod.yml
```

Expected:

- Local Compose still `db:migrate`; prod Compose still `start:prod:migrations`
- New comments/wording appear in README §8.x, Compose comments, DOCKER_PRODUCTION, AGENTS (and EXAMPLES if edited)
- Diff for `apps/`, `libs/`, `package.json`, `package-lock.json`, and prod Compose command is empty

## Full verification

Docs/comments-only change set — **no** `npm run build` / `lint` / test gate required for acceptance of P3-11.

Optional sanity (not blocking):

```bash
npm run build:migrations
```

Do **not** run `db:migrate`, `db:migrate:prod`, or production Compose against unknown/production databases as part of this issue. Do **not** require `test:postman-coverage` or entrypoint bootstrap.

## Acceptance criteria

- **AC-01:** Docs clearly separate Compose local migrate (`docker-compose.yml` / `npm run db:migrate`, drizzle-kit, no advisory lock) from production advisory-locked migrate (`docker-compose.prod.yml` / `db:migrate:prod` / `start:prod:migrations` / `apps/migrations` entrypoint). Evidence in at least: `docker-compose.yml` comments, `README.md` §8.2 and §8.4, and `DOCKER_PRODUCTION.md` (plus `AGENTS.md` / `EXAMPLES.md` if edited per plan).
- **AC-02:** No accidental instruction remains (in the scoped files) that tells operators to run unprotected `db:migrate` / local Compose migrations against production. Production guidance continues to point at the advisory-locked entrypoint.
- **AC-03 (plan hygiene):** Compose defaults and migration runtime code are unchanged; no silent switch of local Compose to the prod runner.

## Risks

- Over-warning in README §8 may make local Compose look “unsafe for local use”; keep tone: local OK, production must use the other path.
- Ukrainian README / English DOCKER_PRODUCTION / English AGENTS — keep each file’s existing language; no translation pass.
- Comment-only change in `docker-compose.yml` might be overlooked if implementers also change `command` — verify AC-03 via diff.
- Historical review markdown under `docs/agent-reports/` may still mention the footgun; out of scope to rewrite reports.

## Rollback strategy

Revert the documentation/comment commits (or restore the listed markdown/YAML comment edits). No data or runtime rollback.

## Open questions requiring human decision

1. **EXAMPLES.md caveat:** Include the recommended one-liner under §3 / table row, or rely on README + DOCKER_PRODUCTION + Compose comments only? **Recommendation:** include the one-liner for AC-02 discoverability.
2. **AGENTS.md depth:** One sentence under Migration commands vs also expanding the Migrations entrypoint bullets? **Recommendation:** both places, one sentence each (commands block is where agents copy scripts).
3. **Future runtime change:** Should a separate backlog/TASK switch local `docker-compose.yml` migrations to `db:migrate:prod`? **Out of scope for P3-11**; do not decide inside this fix. Default for this plan: **leave local Compose on `db:migrate`**.
