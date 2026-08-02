---
issue_id: P2-18
status: approved
owner: human-approval-required
---

# P2-18 — Align Dockerfile Node major with `.nvmrc` / CI

## Source issue

- Backlog index: `docs/agent-backlog/INDEX.md` — `P2-18` (Medium, Confirmed defect)
- Full issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-18
- Review evidence: `docs/agent-reports/full-review-2026-08-02.md` (Docker Node 24 vs `.nvmrc` / CI 22.22.1)

## Current behavior

| Pin location | Current value |
| --- | --- |
| `Dockerfile` line 3 (`FROM … AS base`) | `node:24-bookworm-slim` |
| `.nvmrc` | `22.22.1` |
| `.github/workflows/release-artifact.yml` (`actions/setup-node` `node-version-file`) | `.nvmrc` → Node **22.22.1** |
| `package.json` / root `package-lock.json` `engines.node` | `>=22.22.1 <25` |
| `AGENTS.md` package-manager note | `>=22.22.1 <25` |

- Local development and the only CI workflow install/build on Node **22.22.1**.
- Every Docker stage (`base`, `build-dependencies`, `builder`, `production-dependencies`, `runtime`, `development`) inherits **Node 24** via `FROM base`.
- Engines allow both majors, so `npm` does not reject either runtime; the skew is still undocumentedly intentional.

No `docker-compose*.yml` Node image pins were found. Only one Dockerfile exists at repo root.

## Confirmed root cause

The production/dev container base image was set to Node **24** while the documented local/CI pin (`.nvmrc`) and release workflow remain on **22.22.1**, without a documented decision to upgrade the container runtime. Builds and runtime behavior can therefore diverge between CI/local and Docker images.

**Issue validity:** still valid on the current branch (Dockerfile still `node:24-bookworm-slim`; `.nvmrc` still `22.22.1`).

## Dependency/runtime flow

```text
.nvmrc (22.22.1)
  └─► GitHub Actions setup-node (release-artifact.yml)
        └─► npm ci / npm run release:check on Node 22

Dockerfile FROM node:24-bookworm-slim AS base
  └─► build-dependencies / builder / production-dependencies / runtime / development
        └─► npm ci / npm run build / node dist/... on Node 24

package.json engines ">=22.22.1 <25"
  └─► accepts both; does not enforce alignment
```

## Goal

Make Docker, `.nvmrc`, and CI use the same Node major (and preferably the same patch family), with `package.json` engines remaining consistent with that choice, and verify install/build on the aligned runtime.

## Scope

**Default path (matches backlog preferred fix — Option A):**

1. Change `Dockerfile` base image from `node:24-bookworm-slim` to `node:22.22.1-bookworm-slim` (tag confirmed active on Docker Hub as of planning).
2. Leave `.nvmrc`, `release-artifact.yml`, and `package.json` / `package-lock.json` engines unchanged (already Node 22.22.1 / `>=22.22.1 <25`).
3. Verify `npm ci` and `npm run build` on Node matching `.nvmrc` (and Docker build if Docker is available).

**Alternate path (Option B — only if human rejects Option A):**

1. Bump `.nvmrc` to a concrete Node 24.x patch.
2. Keep `release-artifact.yml` on `node-version-file: '.nvmrc'` (inherits bump).
3. Keep or explicitly restate `package.json` (and root lockfile) `engines.node` so the chosen 24.x pin remains intentional (today’s `>=22.22.1 <25` already allows Node 24; tighten only if humans want a 24-only range — see open question 3).
4. Update `AGENTS.md` engines note if the documented range changes.
5. Optionally pin Dockerfile to the same patch tag (e.g. `node:24.x.y-bookworm-slim`) instead of floating `24-bookworm-slim`.

Implement **exactly one** path after human approval of this plan (and of any open decision below). Do not combine with P2-16, P2-17, P2-23, or other backlog items.

## Out of scope

- Adding a full CI build/lint/test workflow (P2-23).
- Changing `@types/node` (devDependency `^25.9.3` is types-only; unrelated to runtime image pin).
- Docker Compose, multi-arch image publishing, or Digest-pinning (`node@sha256:…`) unless human explicitly expands scope.
- Application code, Nest modules, OpenAPI, Postman, migrations, or dependency upgrades.
- Marking P2-18 resolved in the backlog (verification + human acceptance only).

## Files to create

- None (implementation).

## Files to modify

**Option A (preferred):**

| Path | Symbol / responsibility |
| --- | --- |
| `Dockerfile` | Line 3: `FROM node:24-bookworm-slim AS base` → `FROM node:22.22.1-bookworm-slim AS base` (all stages inherit via `base`) |

**Option B (only if chosen):**

| Path | Symbol / responsibility |
| --- | --- |
| `.nvmrc` | Pin to chosen Node 24.x.y |
| `Dockerfile` | Keep major 24; preferably pin exact patch tag matching `.nvmrc` |
| `package.json` | `engines.node` — update range so chosen 24.x is allowed and documented |
| `package-lock.json` | Root package `""` → `engines` mirror of `package.json` (only if engines change) |
| `AGENTS.md` | Package-manager Node engines line — keep docs aligned |
| `.github/workflows/release-artifact.yml` | No structural change expected if it continues to use `node-version-file: '.nvmrc'` |

## Files to delete

- None.

## Contract and DI changes

- None. No Nest providers, tokens, or HTTP contracts are affected.

## Implementation steps

1. Confirm human choice: **Option A** (Dockerfile → 22.22.1) vs **Option B** (raise `.nvmrc`/engines to 24). Default if approved without override: **Option A**.
2. Apply the single-line (or Option B multi-file) pin changes listed above.
3. Confirm post-change consistency:
   - Dockerfile major/patch family ≡ `.nvmrc`
   - CI still resolves Node via `.nvmrc`
   - `engines.node` includes the chosen runtime
4. Run targeted verification (below).
5. Run full verification required for this change class (below).
6. Do **not** edit backlog status; leave resolution to post-verification human acceptance.

## Migration and rollout concerns

- **Option A:** Existing deployments built from `node:24-bookworm-slim` will rebuild on Node 22. Low application risk if the project already develops/CI on 22.22.1. Consumers who assumed container Node 24 without reading `.nvmrc` should rebuild images.
- **Option B:** Local/CI jump to Node 24. Current `engines.node` (`>=22.22.1 <25`) already permits Node 24; Option B **must** still update `.nvmrc` (and preferably the Dockerfile patch pin + `AGENTS.md`). Tightening engines to drop Node 22 (or pinning a minimum 24.x) is optional and needs an explicit human decision.
- No database migrations, env schema, or API contract changes.
- Image rebuild required for any running container to pick up the new base.

## Targeted verification

```bash
# Confirm pins (static)
# - Dockerfile FROM matches chosen .nvmrc family
# - .github/workflows/release-artifact.yml still uses node-version-file: '.nvmrc'
# - package.json engines covers chosen runtime

node -v   # expect match to .nvmrc for Option A: v22.22.1
npm ci
npm run build
```

If Docker is available on the implementer machine:

```bash
docker build --target builder -t nest-starter-p2-18-check .
# Optionally inspect: docker run --rm nest-starter-p2-18-check node -v
```

If Docker is unavailable, record that as infrastructure limitation (not a code defect) and rely on local Node matching `.nvmrc` plus static pin inspection.

## Full verification

```bash
npm run build
npm run lint
```

HTTP / OpenAPI / Postman / entrypoint bootstrap: not required for this Dockerfile-only (or pin-only) change unless Option B surfaces unexpected build failures that need broader diagnosis.

## Acceptance criteria

- **AC-01:** Dockerfile Node major matches `.nvmrc`, and the release workflow continues to install that same version via `node-version-file: '.nvmrc'`.
- **AC-02:** `package.json` `engines.node` still covers the chosen runtime (and `AGENTS.md` remains consistent if engines or documented range change).
- **AC-03:** `npm ci` and `npm run build` succeed on the aligned Node version (command evidence recorded).

## Risks

- Floating tags (`24-bookworm-slim` / `22-bookworm-slim`) can move underfoot; exact patch tags reduce surprise but require periodic bumps.
- Option A may surprise anyone who already shipped Node-24 images expecting continued 24.x without reading `.nvmrc`.
- Option B may expose Node-24-only tooling differences not seen on CI today (CI is still 22.22.1 until `.nvmrc` changes).
- Skipping `docker build` when Docker is missing leaves image-tag pullability unverified at implement time (mitigated: `node:22.22.1-bookworm-slim` confirmed active on Docker Hub during planning).

## Rollback strategy

- Revert the Dockerfile `FROM` line (and any Option B `.nvmrc` / engines / docs edits) to the previous commits.
- Rebuild images from the reverted pin.

## Open questions requiring human decision

1. **Alignment direction:** Approve **Option A** (pin Dockerfile to `node:22.22.1-bookworm-slim`, keep local/CI on 22.22.1 — backlog preferred) or **Option B** (consciously move `.nvmrc`/CI/docs to Node 24 and keep Docker on 24)?
2. **Tag strictness (Option A):** Use exact `node:22.22.1-bookworm-slim` (recommended, matches `.nvmrc`) or a floating `node:22-bookworm-slim`?
3. **Engines under Option B:** Keep `>=22.22.1 <25` (still allows 22 and 24) or tighten to a 24-only range once local/CI move to 24?
