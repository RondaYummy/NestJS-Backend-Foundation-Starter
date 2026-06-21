---
issue_id: P3-01
status: proposed
owner: human-approval-required
---

# P3-01 — Узгодити Node engine range з dependency requirements

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P3-01 (Low, Confirmed defect).

Related backlog grouping: **Production readiness** (§10 item 7) and baseline verification **V-01** (clean install).

## Investigation notes (2026-06-21)

**Branch state:** unrelated in-progress work on P2-11 (`outbox-processor.*`); P3-01 files are unchanged.

**Defect status:** **Confirmed — not stale.** `package.json` still declares `engines.node: ">=22 <25"` while `lint-staged@17.0.7` (direct devDependency) requires `>=22.22.1`.

**Evidence commands (planner run):**

| Command                                      | Result                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `grep engines package.json`                  | `"node": ">=22 <25"`                                                    |
| `grep lint-staged package-lock.json`         | `lint-staged@17.0.7`, engines `"node": ">=22.22.1"`                     |
| `grep '>=22.22' package-lock.json`           | Only `lint-staged@17.0.7`                                               |
| `grep '>=22.13' package-lock.json`           | `listr2@10.2.1` (transitive via lint-staged; subsumed by 22.22.1 floor) |
| `node -v && npm ci` (local env Node 24.12.0) | exit 0, no EBADENGINE                                                   |
| Backlog review (Node 22.16.0)                | `npm ci` exit 0 + EBADENGINE for lint-staged                            |

**Toolchain inventory:**

| Location                                      | Current Node reference                | Meets lint-staged `>=22.22.1`?       |
| --------------------------------------------- | ------------------------------------- | ------------------------------------ |
| `package.json` `engines.node`                 | `>=22 <25`                            | Allows non-compliant 22.0–22.22.0    |
| `AGENTS.md`                                   | `>=22 <25`                            | Same mismatch                        |
| `Dockerfile`                                  | `node:24-bookworm-slim`               | Yes                                  |
| `.github/workflows/release-artifact.yml`      | `node-version: '22'` (unpinned patch) | May resolve below 22.22.1 on runners |
| `.nvmrc` / `.node-version` / `.tool-versions` | Absent                                | No local pin                         |
| `package.json` `volta`                        | Absent                                | No pin                               |
| `README.md` §9.1                              | No Node prerequisite                  | N/A                                  |
| `.npmrc` `engine-strict`                      | Absent                                | Warnings only, no hard fail          |

## Current behavior

1. Repository declares Node `>=22 <25` in `package.json` and `AGENTS.md`.
2. `lint-staged@17.0.7` (used by `.husky/pre-commit` → `npx lint-staged`) declares `engines.node: ">=22.22.1"`.
3. On Node versions in `[22.0.0, 22.22.0)` (e.g. 22.16.0 from backlog review), `npm ci` completes but prints `EBADENGINE` warnings for `lint-staged`.
4. No `engine-strict` enforcement — mismatch is warning-only; installs and builds proceed.
5. CI uses `node-version: '22'` without a patch floor; Docker production image uses Node 24 (compliant).
6. No version-manager pin files exist for local development.

## Confirmed root cause

The **declared repository engine floor** (`>=22`) is **lower than the strictest direct dependency floor** (`lint-staged@17.0.7` → `>=22.22.1`). `lint-staged` v17 intentionally dropped Node 20 and raised the minimum to Node 22.22.1. The project already depends on v17; only documentation and tooling pins lag behind.

## Dependency/runtime flow

```text
package.json engines.node
  -> npm install / npm ci engine check (warning or fail if engine-strict)
  -> no runtime impact on API/Worker/Cron/Migrations entrypoints

lint-staged@17.0.7 (devDependency)
  -> listr2@10.2.1 (transitive, engines >=22.13.0)
  -> .husky/pre-commit -> npx lint-staged
       -> pre-commit hook on developer machines / optional CI lint-staged step

Dockerfile (node:24-bookworm-slim)
  -> npm ci in build stage
  -> production runtime on Node 24

.github/workflows/release-artifact.yml
  -> actions/setup-node node-version: '22'
  -> npm ci -> npm run release:check
```

No Application, Infrastructure, or entrypoint runtime code depends on Node patch level. Impact is **developer tooling, CI, and documentation alignment** only.

## Goal

Align the repository’s declared Node engine range and toolchain pins with the **binding** dependency requirement (`>=22.22.1`) so `npm ci` does not emit `EBADENGINE` on supported Node versions and local/CI/Docker/docs agree on the minimum.

## Scope

1. Raise `package.json` `engines.node` to `>=22.22.1 <25`.
2. Sync root `engines` in `package-lock.json`.
3. Update `AGENTS.md` Node prerequisite.
4. Pin CI Node version to at least `22.22.1` (via explicit version or `.nvmrc` + `node-version-file`).
5. Add `.nvmrc` with the agreed minimum patch (default recommendation: `22.22.1`).
6. Verify `npm ci` produces no `EBADENGINE` on Node `>=22.22.1`.

## Out of scope

- Downgrading or replacing `lint-staged` to v16.x (conflicts with current Node 22+ stance; rejected unless human overrides).
- Full README sync (P3-02 covers entrypoint/features/EventBus documentation).
- Changing Dockerfile base from Node 24 (already compliant; optional human decision only).
- Adding Volta / asdf files unless approved in open questions (recommended default: `.nvmrc` only).
- Enabling `engine-strict=true` unless approved (optional hardening).
- Dependency upgrades unrelated to engine alignment.

## Files to create

| Path     | Responsibility                                                                               |
| -------- | -------------------------------------------------------------------------------------------- |
| `.nvmrc` | Pin minimum Node patch for nvm/fnm and CI `node-version-file` (recommended value: `22.22.1`) |

## Files to modify

| Path                                     | Symbol / responsibility               | Change                                                                                  |
| ---------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| `package.json`                           | `engines.node`                        | `"node": ">=22.22.1 <25"`                                                               |
| `package-lock.json`                      | root `packages[""].engines.node`      | Sync to `>=22.22.1 <25` (via `npm install --package-lock-only` or manual edit + verify) |
| `AGENTS.md`                              | Package manager section, Node.js line | `>=22.22.1 <25`                                                                         |
| `.github/workflows/release-artifact.yml` | `Setup Node.js` step, `node-version`  | Use `node-version-file: '.nvmrc'` **or** `node-version: '22.22.1'`                      |

## Files to delete

None.

## Contract and DI changes

None. No NestJS modules, ports, tokens, or runtime contracts change.

## Implementation steps

1. **Update manifest engines**
   - Edit `package.json`: set `engines.node` to `">=22.22.1 <25"`.
   - Regenerate or manually sync root engines in `package-lock.json`.

2. **Add version pin file**
   - Create `.nvmrc` containing `22.22.1` (or human-approved 22 LTS patch).

3. **Align CI**
   - In `.github/workflows/release-artifact.yml`, replace `node-version: '22'` with either:
     - `node-version-file: '.nvmrc'` (preferred — single source of truth), or
     - `node-version: '22.22.1'`.
   - Keep `cache: npm` unchanged.

4. **Update agent documentation**
   - Edit `AGENTS.md` line documenting Node.js to `>=22.22.1 <25`.

5. **Optional (only if human approves in open questions)**
   - Add `.node-version` mirroring `.nvmrc` (asdf/fnm).
   - Add `.tool-versions` with `nodejs 22.22.1` (asdf).
   - Add `volta` block to `package.json`.
   - Add `.npmrc` with `engine-strict=true`.
   - Add one-line Node prerequisite to `README.md` §9.1 before `npm install`.

6. **Do not change**
   - `Dockerfile` — `node:24-bookworm-slim` satisfies `>=22.22.1 <25`.
   - `.husky/pre-commit` — no version reference.
   - `lint-staged` version — keep `^17.0.7`.

## Migration and rollout concerns

- **Developer impact:** anyone on Node `22.0.0`–`22.22.0` must upgrade to `>=22.22.1` before `npm ci` is guaranteed clean (or before `engine-strict` would block installs).
- **CI:** pinning to `22.22.1` or `.nvmrc` prevents runner cache drift below the dependency floor.
- **Docker:** no rollout change; Node 24 image remains valid.
- **Backward compatibility:** this is an intentional tightening of the documented/supported floor; not a runtime API break.

## Targeted verification

```bash
# Confirm manifest
node -p "require('./package.json').engines.node"
# Expect: >=22.22.1 <25

# Clean install on compliant Node (>=22.22.1)
node -v   # must be >=22.22.1
npm ci --no-audit --no-fund 2>&1 | grep -i EBADENGINE || echo "no EBADENGINE"
# Expect: no EBADENGINE lines

# Pre-commit tooling
npx lint-staged --version
# Expect: 17.0.7 (or resolved 17.x)
```

If Node version managers are available, additionally verify on Node `22.16.0`:

```bash
# Before fix: EBADENGINE warning expected
# After fix: npm should report engine mismatch for the repo itself (warning);
#            lint-staged EBADENGINE should not occur when using Node >=22.22.1
```

## Full verification

```bash
npm ci
npm run build
npm run lint
npm run test:unit
```

Record command, exit code, and conclusion per project verification rules. Re-run **Release artifact check** workflow after CI change (or confirm `node-version-file` resolves correctly).

## Acceptance criteria

- [ ] `package.json` `engines.node` is `>=22.22.1 <25`.
- [ ] Root `package-lock.json` engines match `package.json`.
- [ ] `AGENTS.md` documents `>=22.22.1 <25`.
- [ ] `.nvmrc` exists and pins at least `22.22.1`.
- [ ] `.github/workflows/release-artifact.yml` uses Node `>=22.22.1` (via `.nvmrc` or explicit version).
- [ ] `npm ci` on Node `>=22.22.1` completes with **no** `EBADENGINE` warnings for `lint-staged`.
- [ ] `npm run build`, `npm run lint`, and `npm run test:unit` pass on compliant Node.
- [ ] No production/runtime code changes; scope limited to engines and toolchain alignment.

## Risks

| Risk                                                 | Mitigation                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Developers on old Node 22.x patch blocked or warned  | Document upgrade in commit/PR; `.nvmrc` enables one-command switch |
| CI runner resolves stale Node 22 cache below 22.22.1 | Pin explicit version or use `node-version-file`                    |
| Optional `engine-strict` breaks existing workflows   | Leave disabled unless explicitly approved                          |
| Downgrade lint-staged temptation                     | Rejected — plan raises floor instead                               |

## Rollback strategy

Revert `package.json` engines, `package-lock.json` root engines, `.nvmrc`, CI node version, and `AGENTS.md` in a single commit. No migrations or data changes to roll back.

## Open questions requiring human decision

1. **Exact pin value:** use `22.22.1` in `.nvmrc`/CI, or track latest 22.x LTS patch (e.g. `22.22.1` minimum in engines but `.nvmrc` at current LTS)?
2. **`engine-strict`:** add `.npmrc` with `engine-strict=true` so unsupported Node fails `npm ci` instead of warning?
3. **Additional toolchain files:** `.nvmrc` only (recommended), or also `.node-version`, `.tool-versions`, and/or `volta` in `package.json`?
4. **Dockerfile:** keep `node:24-bookworm-slim` (recommended) or align image to Node 22 LTS for dev/prod parity?
5. **README §9.1:** add a one-line Node prerequisite in this fix, or defer to P3-02?
6. **lint-staged downgrade:** confirm rejection of pinning/replacing `lint-staged@16.x`?
