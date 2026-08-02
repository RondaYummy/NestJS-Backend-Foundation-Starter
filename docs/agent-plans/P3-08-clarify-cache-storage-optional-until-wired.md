---
issue_id: P3-08
status: approved
owner: human-approval-required
---

# P3-08 — Clarify Cache/Storage as optional until wired in entrypoints

## Source issue

- Backlog ID: `P3-08`
- Index: `docs/agent-backlog/INDEX.md`
- Full text: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-08
- Review source: `docs/agent-reports/full-review-2026-08-02.md` (Low — Cache/Storage described as system modules without wiring)

## Current behavior

Confirmed on current branch (inspected 2026-08-02):

1. **Modules exist and are extractable:**
   - `libs/infrastructure/src/cache/cache.module.ts` — `CacheModule.register({ imports? })` exports `TOKENS.CacheGateway` / `RedisCacheGateway` (peer: `RedisModule`).
   - `libs/infrastructure/src/storage/storage.module.ts` — `StorageModule.forRoot` / `forRootAsync` exports `TOKENS.StorageGateway` (`LocalStorageAdapter` | `S3StorageAdapter`).
   - Contracts: `libs/contracts/src/cache/cache-gateway.ts` (`ICacheGateway`), `libs/contracts/src/storage/storage-gateway.ts` (`IStorageGateway`), tokens in `libs/contracts/src/tokens.ts`.
   - Mapper: `mapAppConfigToStorageOptions` in `libs/infrastructure/src/config/create-starter-kit-module-options.ts`.
   - Env still validates `STORAGE_DRIVER` / S3 fields via `env.schema.ts` (config surface exists even when the Nest module is not imported).

2. **No default entrypoint wiring** (grep of `apps/**` for `CacheModule` / `StorageModule` / `mapAppConfigToStorageOptions` / `ICacheGateway` / `IStorageGateway`: **zero matches**):
   - `apps/api/src/api.module.ts` — Redis, Drizzle, BullMQ, Health, RateLimiter, Idempotency, Auth; **no** Cache/Storage.
   - `apps/worker/src/worker.module.ts` — Mail, OutboxProcessor, Idempotency; **no** Cache/Storage.
   - `apps/cron/src/cron.module.ts` — Locks, OutboxProcessorOptions; **no** Cache/Storage.

3. **Docs imply presence without “not wired”:**
   - `README.md` “Starter включає” (~L19–L23) lists `cache layer` and `storage module` alongside Redis/BullMQ/Mail — modules that **are** imported in default entrypoints — with no optional/not-wired caveat.
   - `README.md` § **5.6. Cache Module** and § **5.10. Storage Module** describe purpose, contracts, and usage examples but never state that default API/Worker/Cron do **not** import these modules.
   - `MODULES_OVERVIEW_NON_TECH.md` § **14. Cache Module** and § **18. Storage Module** describe them as parts of the system (“швидка памʼять” / “файлове сховище системи”) without saying they are optional adapters until composed.
   - Infrastructure overview in MODULES (~L112) correctly says modules are wired explicitly at composition roots, but does **not** call out that Cache/Storage specifically are **shipped but unused** in the default starter entrypoints (unlike Mail on Worker, RateLimiter/Idempotency on API, Locks on Cron).

4. **Extraction / EXAMPLES already show *how* to register**, not default wiring status:
   - `docs/infrastructure-modules/README.md` registration matrix rows for `StorageModule` / `CacheModule` + Storage `forRoot` snippet.
   - `docs/infrastructure-modules/EXTRACTION_GUIDE.md` § StorageModule / § CacheModule.
   - `EXAMPLES.md` § **13** lists registration APIs for both modules among typical examples.

## Confirmed root cause

Documentation presents Cache and Storage as included foundation capabilities in the same voice as modules that are already composed into API/Worker/Cron. Adapters and contracts are real, but **no composition root imports them**, so readers can reasonably infer they are “already active” rather than “optional copy-kit adapters to import when a feature needs them.” This is a documentation mismatch only; runtime is intentionally unwired.

## Dependency/runtime flow

```text
libs/contracts  ICacheGateway / IStorageGateway + TOKENS.*
        ^
        | implemented by
libs/infrastructure
  CacheModule.register({ imports: [redisModule] })
  StorageModule.forRoot / forRootAsync (+ mapAppConfigToStorageOptions)
        ^
        | MUST be imported by a composition root to be active
apps/api | apps/worker | apps/cron
  (today: none import CacheModule or StorageModule)
```

Env/`AppConfigService.storage()` may still parse storage settings; that does **not** register Nest providers. Injecting `TOKENS.CacheGateway` / `TOKENS.StorageGateway` without importing the modules fails DI.

## Goal

Clarify in product and module docs that Cache and Storage are **optional adapters**: present in the kit, documented for composition/extraction, **not** imported by default API/Worker/Cron. Link to extraction / EXAMPLES guidance. Leave all production TypeScript unchanged (AC-02).

## Scope

- Doc-only clarifications in README, MODULES overview, and infrastructure-modules notes (and a one-line EXAMPLES pointer if needed for discoverability).
- Cross-links to `docs/infrastructure-modules/README.md`, `EXTRACTION_GUIDE.md`, and/or `EXAMPLES.md` §13.
- Register this plan in `docs/agent-plans/INDEX.md` (planner hygiene).
- Verify with greps that misleading “already wired” implications are gone and that `apps/` still has no Cache/Storage imports.

## Out of scope

- Any other backlog ID (P2-xx, P3-09+, TASK-xxx).
- Importing `CacheModule` / `StorageModule` into API, Worker, or Cron (explicitly forbidden by the issue unless a separate TASK requests demo wiring).
- Changing adapters, contracts, env schema, mappers, or module registration APIs.
- Adding demo controllers/use cases for cache or file upload.
- HTTP endpoints, OpenAPI, or Postman updates.

### HTTP / OpenAPI / Postman

This fix does **not** add or change HTTP endpoints. No OpenAPI decorator/schema updates and no `docs/postman/` collection updates are required. Do not run `npm run test:postman-coverage` as acceptance for this issue.

## Files to create

- None.

## Files to modify

| Path | Symbols / responsibility |
| --- | --- |
| `README.md` | **Starter включає** (~L19–L23): qualify `cache layer` and `storage module` as optional adapters available in the kit but **not** imported by default entrypoints (keep them listed — they ship with the kit). § **5.6. Cache Module**: after purpose/path, add a short **Registration / default entrypoints** note: must `CacheModule.register({ imports: [redisModule] })` in a composition root; default API/Worker/Cron do **not** import it; link `docs/infrastructure-modules/README.md` (CacheModule row) + `EXAMPLES.md` §13 + `EXTRACTION_GUIDE.md` CacheModule. § **5.10. Storage Module**: same pattern for `StorageModule.forRoot` / `forRootAsync` (+ optional mention of `mapAppConfigToStorageOptions`); default entrypoints do **not** import it. Do **not** rewrite full API method docs. |
| `MODULES_OVERVIEW_NON_TECH.md` | § **14. Cache Module** and § **18. Storage Module**: add one plain-language sentence that the module exists in the starter kit but is connected only when a team imports it into an entrypoint composition root; it is not active in the default API/Worker/Cron wiring. Optionally strengthen § Infrastructure overview (~L112) by naming Cache alongside Storage as examples of modules that may ship unwired until needed (keep non-technical tone). Link to `docs/infrastructure-modules/README.md` where appropriate. |
| `docs/infrastructure-modules/README.md` | Registration matrix **Notes** for `CacheModule` and `StorageModule`: e.g. “Optional in default starter entrypoints — import at composition root when needed; not wired in shipped API/Worker/Cron.” Keep existing API/peer notes. Optionally one sentence under the Storage snippet that default apps omit this import. |
| `docs/infrastructure-modules/EXTRACTION_GUIDE.md` | Under **CacheModule** and **StorageModule** tables: add a **Note** (or **Do not**) row: default starter entrypoints do not import this module; wire at composition root when a feature needs it. |
| `EXAMPLES.md` | § **13** (optional, recommended): one sentence after the registration-API bullets stating that `CacheModule` / `StorageModule` appear in the matrix as available adapters but are **not** registered in the kit’s default API/Worker/Cron modules — copy the pattern from Mail/Redis wiring only when a feature needs them. |
| `docs/agent-plans/INDEX.md` | Add row for `P3-08` → this plan while `proposed`. |

## Files to delete

- None.

## Contract and DI changes

- **None.** No token, provider, export, or composition-root changes.
- Docs must not claim that env `STORAGE_*` alone activates `TOKENS.StorageGateway`.

## Implementation steps

1. Confirm still unwired: `rg "CacheModule|StorageModule" apps` → no matches (baseline).
2. Edit `README.md` “Starter включає” + §5.6 + §5.10 with optional/not-wired wording and links.
3. Edit `MODULES_OVERVIEW_NON_TECH.md` §14 / §18 (and light touch at ~L112 if it improves clarity without overselling).
4. Edit `docs/infrastructure-modules/README.md` matrix Notes (+ optional Storage section sentence).
5. Edit `docs/infrastructure-modules/EXTRACTION_GUIDE.md` Cache/Storage tables.
6. Optionally edit `EXAMPLES.md` §13 with the one-line default-entrypoint caveat.
7. Grep docs for residual implications that Cache/Storage are active in default apps; fix only P3-08-scoped wording.
8. Do **not** change any file under `apps/`, `libs/`, or `package.json`.

## Migration and rollout concerns

- Documentation-only; no runtime, migration, or env rollout impact.
- Integrators who already copy-wired Cache/Storage are unaffected.
- Readers who assumed default wiring may discover they must import the modules — that is the intended correction.

## Targeted verification

```bash
# Still unwired in entrypoints
rg "CacheModule|StorageModule|mapAppConfigToStorageOptions" apps

# Docs state optional / not default-wired (adjust patterns to final wording)
rg -n "optional|not (imported|wired)|composition root|за замовчуванням|не підключ" README.md MODULES_OVERVIEW_NON_TECH.md docs/infrastructure-modules/README.md docs/infrastructure-modules/EXTRACTION_GUIDE.md EXAMPLES.md

# No production code drift from this issue
git diff --name-only -- apps libs package.json package-lock.json
```

Expected: `apps` grep empty; doc greps hit the new clarifications; production paths unchanged.

## Full verification

Docs-only change set — **no** `npm run build` / `lint` / test gate required for acceptance of P3-08.

Optional sanity (not blocking if docs-only):

```bash
npm run build
```

Do **not** require `test:postman-coverage` or entrypoint bootstrap for this issue.

## Acceptance criteria

- **AC-01:** Docs no longer imply Cache/Storage are active in default entrypoints. README feature list and module sections, MODULES overview §14/§18, and infrastructure-modules notes (plus EXAMPLES §13 if edited) explicitly mark them as optional until imported at a composition root, with links to extraction / EXAMPLES guidance.
- **AC-02:** No production code changes under `apps/` or `libs/` (and no dependency lockfile changes) unless a separate approved task adds wiring — this plan requires **none**.
- **AC-03 (plan hygiene):** Plan remains documentation-scoped; no demo wiring added “for completeness.”

## Risks

- Over-qualifying the README feature list may make other unwired-but-listed capabilities look inconsistent; keep the caveat **scoped to Cache and Storage** as the issue requires (do not turn this into a full “wired vs unwired” audit of every bullet).
- MODULES is non-technical — wording must stay plain language while still accurate.
- Env still documents `STORAGE_*`; without a one-line note, readers might still confuse config presence with DI wiring — address briefly in Storage README section if space allows.

## Rollback strategy

Revert the documentation commits (or restore the listed markdown files). No data or runtime rollback.

## Open questions requiring human decision

1. **EXAMPLES.md §13:** Recommended one-liner vs skip (infrastructure-modules + README may be enough). Default recommendation: **include** the one-liner for discoverability.
2. **README “Starter включає” style:** Prefer parenthetical on the two bullets (`cache layer (optional until wired…)`) vs a short footnote under the list. Default recommendation: **qualify the two bullets inline** to keep the list scannable.
3. **Language:** README/MODULES are primarily Ukrainian; infrastructure-modules docs are English. Keep each file’s existing language (no full translation pass).
