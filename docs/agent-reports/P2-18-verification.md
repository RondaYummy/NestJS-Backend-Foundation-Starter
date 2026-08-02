# P2-18 — Independent verification

## Verdict

approved

## Scope checked

- Backlog index confirms `P2-18` (Medium, Confirmed defect): Align Dockerfile Node major with `.nvmrc` / CI.
- Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-18.
- Plan: `docs/agent-plans/P2-18-align-dockerfile-node-major.md` — `status: approved`; Option A (default).
- Product change in scope: single-line Dockerfile base pin only.
  - Staged diff: `FROM node:24-bookworm-slim AS base` → `FROM node:22.22.1-bookworm-slim AS base`.
  - All other stages (`build-dependencies`, `builder`, `production-dependencies`, `runtime`, `development`) inherit via `FROM base` / `FROM build-dependencies`; no other Node image pins.
- Unchanged (as planned for Option A): `.nvmrc` (`22.22.1`), `.github/workflows/release-artifact.yml` (`node-version-file: '.nvmrc'`), `package.json` / root `package-lock.json` `engines.node` (`>=22.22.1 <25`), `AGENTS.md` engines note.
- Implementation report present and consistent with Option A; not trusted alone — pins and commands re-checked independently.
- Index hygiene note (not a product-code change): `git status` also shows `AD node_modules.bak-p218/.../resolver.win32-x64-msvc.node.bak-133708` (implementer local npm-ci workaround artifact). Worktree bak tree is absent; this path must not be committed with the Dockerfile fix. Does not alter Dockerfile/runtime behavior or fail ACs.

## Root-cause assessment

- Original root cause: production/dev container used Node **24** while local/CI pin remained **22.22.1**, without a documented upgrade.
- Option A addresses that directly by pinning the shared `base` stage to `node:22.22.1-bookworm-slim`, matching `.nvmrc` patch family and CI resolution via `.nvmrc`.
- Not a symptom-only change: the divergent runtime pin itself was corrected; engines already allowed 22.x and were left consistent.

## Acceptance criteria matrix

| ID | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| AC-01 | Dockerfile Node major matches `.nvmrc`, and release workflow continues to install that version via `node-version-file: '.nvmrc'` | **passed** | Dockerfile line 3: `FROM node:22.22.1-bookworm-slim AS base`; `.nvmrc`: `22.22.1`; `release-artifact.yml` L25: `node-version-file: '.nvmrc'` |
| AC-02 | `package.json` `engines.node` still covers the chosen runtime (`AGENTS.md` consistent if engines/docs change) | **passed** | `package.json` / lockfile root: `>=22.22.1 <25` (covers 22.22.1); `AGENTS.md` still documents `>=22.22.1 <25`; no engines edit required under Option A |
| AC-03 | `npm ci` and `npm run build` succeed on the aligned Node version | **passed** | Host `node -v` → `v22.22.1` (= `.nvmrc`); `npm ci` exit 0; `npm run build` exit 0 |

## Dependency and DI verification

- No Nest modules, tokens, providers, composition roots, HTTP contracts, OpenAPI, or Postman changes.
- Runtime impact is image base Node major/patch only; application DI chains unaffected.

## Commands executed

Command:
`node -v`
Result:
`v22.22.1`
Conclusion:
Host Node matches `.nvmrc` (aligned runtime for AC-03).

Command:
Static pin inspection (Dockerfile, `.nvmrc`, `package.json` engines, `package-lock.json` root engines, `AGENTS.md`, `release-artifact.yml`)
Result:
Dockerfile `22.22.1-bookworm-slim`; `.nvmrc` `22.22.1`; engines `>=22.22.1 <25`; workflow uses `.nvmrc`
Conclusion:
AC-01 and AC-02 satisfied by inspection.

Command:
`docker version`
Result:
Client present; daemon failed — `npipe:////./pipe/dockerDesktopLinuxEngine` not found
Conclusion:
Docker engine unavailable (infrastructure limitation). Skipped `docker build` per plan; not treated as a product defect.

Command:
`npm ci`
Result:
exit 0 (1012 packages added; deprecation/audit warnings only)
Conclusion:
Install succeeds on Node 22.22.1 (AC-03).

Command:
`npm run build`
Result:
exit 0 (`nest build api && worker && cron && migrations`)
Conclusion:
Build succeeds on aligned Node (AC-03 / full verification).

Command:
`npm run lint`
Result:
exit 0 (`eslint . --max-warnings=0`)
Conclusion:
Lint gate passes (full verification for this change class).

## Findings

1. Dockerfile Option A pin is correctly applied and inherited by all stages.
2. Local/CI/Docker Node major (and patch family for Docker/`nvmrc`) are aligned at **22.22.1**.
3. Engines and AGENTS remain consistent without further edits.
4. `npm ci` + `npm run build` + `npm run lint` verified green on `v22.22.1`.
5. Residual index noise: staged-then-deleted `node_modules.bak-p218/...bak-*` path should be cleared from the index before commit; unrelated to the fix correctness.
6. Image pullability / in-container `node -v` not re-verified here because Docker daemon was down (same limitation recorded by implementer).

## Documentation alignment

- Issue, approved plan (Option A), and implementation match observed diff.
- No documentation updates were required for Option A; `AGENTS.md` engines line remains accurate.
- Backlog issue correctly left unresolved pending human acceptance (out of implementer/verifier scope).

## Remaining risks

- `node:22.22.1-bookworm-slim` pullability was not confirmed with a live `docker build` on this machine (Docker Desktop engine unavailable).
- Consumers who already built images from floating `node:24-bookworm-slim` will rebuild on Node 22 after this change (expected Option A rollout).
- Accidental commit of the implementer bak artifact remains a process risk until the index is cleaned.

## Unverified areas

- `docker build --target builder` and in-image `node -v`.
- Entrypoint bootstrap / HTTP / OpenAPI / Postman (not required for this Dockerfile-only change per approved plan).
