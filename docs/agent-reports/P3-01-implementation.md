# P3-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P3-01-align-node-engine-range.md` (`status: approved`)

## Changed files

| Path                                     | Change                                                     |
| ---------------------------------------- | ---------------------------------------------------------- |
| `package.json`                           | `engines.node` raised from `>=22 <25` to `>=22.22.1 <25`   |
| `package-lock.json`                      | Root `packages[""].engines.node` synced to `>=22.22.1 <25` |
| `.nvmrc`                                 | Created with minimum patch pin `22.22.1`                   |
| `.github/workflows/release-artifact.yml` | `node-version: '22'` → `node-version-file: '.nvmrc'`       |
| `AGENTS.md`                              | Node.js prerequisite updated to `>=22.22.1 <25`            |

No production/runtime TypeScript, NestJS modules, or entrypoint code changed.

## Completed steps

1. **Updated manifest engines** — `package.json` `engines.node` set to `>=22.22.1 <25`.
2. **Synced lockfile root engines** — `package-lock.json` root `engines.node` matched manually (no dependency version changes).
3. **Added version pin file** — `.nvmrc` created with `22.22.1`.
4. **Aligned CI** — release-artifact workflow uses `node-version-file: '.nvmrc'`; `cache: npm` unchanged.
5. **Updated agent documentation** — `AGENTS.md` Node.js line updated.
6. **Skipped optional items** (per plan defaults / open questions) — no `.node-version`, `.tool-versions`, `volta`, `engine-strict`, README §9.1, or Dockerfile changes.

## Deviations

None. Implementation matches the approved plan scope and default recommendations for open questions (`.nvmrc` only, no `engine-strict`, Dockerfile unchanged, README deferred to P3-02).

## Commands executed

| Command                                            | Result                         | Conclusion                              |
| -------------------------------------------------- | ------------------------------ | --------------------------------------- |
| `node -p "require('./package.json').engines.node"` | Exit 0, `>=22.22.1 <25`        | Manifest engines correct                |
| `node -v`                                          | `v24.12.0`                     | Compliant Node (>=22.22.1)              |
| `npm ci --no-audit --no-fund`                      | Exit 0, no `EBADENGINE` output | Clean install on compliant Node         |
| `npx lint-staged --version`                        | Exit 0, `17.0.7`               | Pre-commit tooling resolves as expected |
| `npm run build`                                    | Exit 0                         | All entrypoints compile                 |
| `npm run lint`                                     | Exit 0                         | Full-repo lint gate passes              |
| `npm run test:unit`                                | Exit 0, 115/115 tests          | Full unit suite passes                  |

## Command results

- **Engine alignment:** repository floor now matches `lint-staged@17.0.7` requirement (`>=22.22.1`).
- **`npm ci` on Node 24.12.0:** completes with no `EBADENGINE` warnings.
- **Build / lint / unit tests:** all pass with runtime evidence.
- **CI workflow change:** not executed locally; `node-version-file: '.nvmrc'` is the documented `actions/setup-node@v4` pattern and should resolve to `22.22.1` on GitHub runners after merge.

## Acceptance criteria self-check

| Criterion                                                                     | Status             |
| ----------------------------------------------------------------------------- | ------------------ |
| `package.json` `engines.node` is `>=22.22.1 <25`                              | Met                |
| Root `package-lock.json` engines match `package.json`                         | Met                |
| `AGENTS.md` documents `>=22.22.1 <25`                                         | Met                |
| `.nvmrc` exists and pins at least `22.22.1`                                   | Met                |
| `.github/workflows/release-artifact.yml` uses Node `>=22.22.1` via `.nvmrc`   | Met                |
| `npm ci` on Node `>=22.22.1` completes with no `EBADENGINE` for `lint-staged` | Met (Node 24.12.0) |
| `npm run build`, `npm run lint`, `npm run test:unit` pass on compliant Node   | Met                |
| No production/runtime code changes; scope limited to engines and toolchain    | Met                |

## Remaining risks

1. **Developers on Node 22.0.0–22.22.0** — must upgrade to `>=22.22.1`; `.nvmrc` enables `nvm use` / `fnm use` but README prerequisite is still deferred to P3-02.
2. **CI not re-run locally** — first post-merge run of Release artifact check should confirm `node-version-file` resolves correctly on GitHub-hosted runners.
3. **No `engine-strict`** — unsupported Node versions still produce warnings only; installs are not hard-blocked unless `.npmrc` hardening is approved later.

## Unverified areas

- `npm ci` on exactly Node `22.22.1` (local environment is Node 24.12.0).
- GitHub Actions **Release artifact check** workflow after CI YAML change.
- Behavior on Node `22.16.0` (expected: repo engine warning if below floor; not tested in this environment).
