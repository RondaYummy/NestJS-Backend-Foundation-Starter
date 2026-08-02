# P2-18 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-18-align-dockerfile-node-major.md` (`status: approved`)

Path applied: **Option A** (default when approved without override) — pin Dockerfile base to `node:22.22.1-bookworm-slim`; leave `.nvmrc`, CI workflow, and `engines` unchanged.

## Changed files

- `Dockerfile` — `FROM node:24-bookworm-slim AS base` → `FROM node:22.22.1-bookworm-slim AS base`
- `docs/agent-reports/P2-18-implementation.md` (this report)

## Completed steps

1. Revalidated plan against current branch: issue `P2-18` still present in backlog INDEX and `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`; Dockerfile still used Node 24; `.nvmrc` still `22.22.1`; release workflow still uses `node-version-file: '.nvmrc'`; no conflicting user edits on `Dockerfile`.
2. Applied Option A single-line Dockerfile base-image pin to `node:22.22.1-bookworm-slim` (all stages inherit via `base`).
3. Confirmed post-change consistency: Dockerfile patch family ≡ `.nvmrc` (`22.22.1`); CI still resolves via `.nvmrc`; `package.json` `engines.node` `>=22.22.1 <25` covers the chosen runtime; `AGENTS.md` engines note unchanged (no engines change).
4. Ran targeted verification: `node -v` → `v22.22.1`; `npm ci` → pass; `npm run build` → pass.
5. Ran full verification: `npm run build` → pass; `npm run lint` → pass (after cleanup of a temporary local rename artifact — see Deviations).
6. Did **not** change backlog issue status.

## Deviations

- **Docker image build not executed:** Docker Desktop engine pipe unavailable (`npipe:////./pipe/dockerDesktopLinuxEngine`). Recorded as infrastructure limitation per plan; relied on local Node matching `.nvmrc` plus static pin inspection.
- **Initial `npm ci` EPERM:** First `npm ci` failed unlinking a locked native binding under `node_modules/@unrs/...`. Workaround: renamed locked file and moved `node_modules` aside to `node_modules.bak-p218`, then re-ran `npm ci` successfully. A leftover `node_modules.bak-p218` directory may remain on disk if Windows still holds handles; it is **not** part of the product change and should be deleted locally when unlocked. Brief first lint failure was caused by eslint scanning that bak tree (`node_modules/**` ignore does not cover `node_modules.bak-*`); lint re-run after cleanup attempt passed with exit 0.

## Commands executed

| Command | Result | Conclusion |
| --- | --- | --- |
| Static pin inspection (Dockerfile / `.nvmrc` / engines / workflow) | Dockerfile `node:22.22.1-bookworm-slim`; `.nvmrc` `22.22.1`; engines `>=22.22.1 <25`; workflow `node-version-file: '.nvmrc'` | Pins aligned (AC-01, AC-02) |
| `node -v` | `v22.22.1` | Matches `.nvmrc` |
| `docker version` | Failed — Docker Desktop engine not running | Infra unavailable; skipped `docker build` |
| `npm ci` (first attempt) | exit `-4048` EPERM unlink on `@unrs` native binding | Local file lock; not a product defect |
| `npm ci` (after renaming locked `node_modules`) | exit `0` | Install OK on Node 22.22.1 (AC-03) |
| `npm run build` | exit `0` | Build OK on aligned Node (AC-03) |
| `npm run lint` (with bak tree present) | exit `1` (~19k errors from `node_modules.bak-p218`) | Transient; caused by local bak artifact |
| `npm run lint` (retry) | exit `0` | Pass |

## Command results

- **Pass:** pin alignment, `node -v`, `npm ci` (retry), `npm run build`, `npm run lint` (retry).
- **Infra skip:** `docker build --target builder …` not run (Docker daemon unavailable).
- **Transient fail then pass:** first `npm ci` (file lock); first lint (bak tree).

## Acceptance criteria self-check

| ID | Criterion | Status |
| --- | --- | --- |
| AC-01 | Dockerfile Node major matches `.nvmrc`, and release workflow continues to install via `node-version-file: '.nvmrc'` | **Met** — `22.22.1` / `22.22.1` / workflow unchanged |
| AC-02 | `package.json` `engines.node` still covers the chosen runtime (`AGENTS.md` consistent) | **Met** — `>=22.22.1 <25` unchanged; docs unchanged |
| AC-03 | `npm ci` and `npm run build` succeed on the aligned Node version | **Met** — both exit 0 on `v22.22.1` |

## Remaining risks

- Image-tag pullability of `node:22.22.1-bookworm-slim` was confirmed at planning time on Docker Hub but not re-verified with a live `docker build` on this machine.
- Consumers who already shipped Node-24 images expecting continued floating `24-bookworm-slim` will rebuild on Node 22 after this change (planned Option A rollout note).

## Unverified areas

- `docker build --target builder` and in-image `node -v` (Docker unavailable).
- No entrypoint bootstrap / HTTP / OpenAPI / Postman checks (not required for this Dockerfile-only change per plan).
