# P2-10 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-10-exclude-env-git-release-archive.md` (`status: approved`)

## Changed files

| Path                                     | Change                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.gitattributes`                         | Added `export-ignore` for `.husky/`, `docs/agent-plans/`, `docs/agent-reports/`          |
| `.github/workflows/release-artifact.yml` | CI workflow: `npm run release:check` + gitleaks scan                                     |
| `.gitleaks.toml`                         | Allowlist for documented `.env.example` dev placeholders                                 |
| `scripts/release/release-policy.ts`      | Shared deny/require policy, secret heuristics, dockerignore validation                   |
| `scripts/release/build-archive.ts`       | Builds versioned ZIP via `git archive` into `dist/release/`                              |
| `scripts/release/verify-archive.ts`      | Deny manifest, required-file checks, lightweight secret scan                             |
| `scripts/release/dockerignore-policy.ts` | Asserts `.dockerignore` contains required deny patterns                                  |
| `scripts/release/release-policy.spec.ts` | Unit tests for policy helpers                                                            |
| `scripts/release/tsconfig.json`          | ts-node project config for release scripts                                               |
| `package.json`                           | Added `release:archive`, `release:verify`, `release:check-dockerignore`, `release:check` |
| `README.md`                              | §25 — documented safe release packaging and warnings against naive zipping               |
| `README_CURSOR_AGENTS.md`                | ZIP install step references maintainer `npm run release:archive`                         |
| `.gitignore`                             | Explicit `dist/release` entry (also covered by existing `dist/`)                         |

## Completed steps

1. **Shared policy module** — forbidden paths (`.env`, `.git/`, `node_modules/`, keys, dumps), required files (`.env.example`, `package.json`, `Dockerfile`, `.dockerignore`), dockerignore patterns, secret heuristics with placeholder allowlist.
2. **`.gitattributes`** — conservative `export-ignore` for dev-only tracked paths per approved open question #1.
3. **`build-archive.ts`** — `git archive --format=zip` to `dist/release/nestjs-backend-foundation-starter-<version>.zip`; supports `RELEASE_GIT_REF`.
4. **`verify-archive.ts`** — pure-Node ZIP directory reader; fails on forbidden paths, missing required files, and high-confidence secret patterns.
5. **`dockerignore-policy.ts`** — reuses shared constants to validate `.dockerignore`.
6. **`package.json` scripts** — wired `release:check` chain as specified.
7. **GitHub Actions** — `release-artifact.yml` on `push`/`pull_request`/`workflow_dispatch` with gitleaks + `release:check`.
8. **Documentation** — README §25 and README_CURSOR_AGENTS.md updated.
9. **Unit tests** — 9 tests in `release-policy.spec.ts`.

## Deviations

| Plan item                       | Actual                                                        | Reason                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release scripts as `.mjs`       | Implemented as `.ts` run via existing `ts-node` devDependency | Jest cannot execute ESM `.mjs` policy modules in the current unit-test setup; `.ts` keeps one source of truth testable by `release-policy.spec.ts` without new dependencies |
| `scripts/release/tsconfig.json` | Added                                                         | Required so `ts-node` can compile release scripts outside Nest app tsconfig `rootDir`                                                                                       |

## Commands executed

| Command                                                       | Result                                                                                  | Conclusion                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| `npm run release:check-dockerignore`                          | Exit 0                                                                                  | `.dockerignore` policy passes                                             |
| `npm run release:archive`                                     | Exit 0                                                                                  | ZIP created at `dist/release/nestjs-backend-foundation-starter-1.0.0.zip` |
| `npm run release:verify`                                      | Exit 0                                                                                  | 427 entries; `.env.example` present; no `.env`/`.git/`                    |
| `npm run release:check`                                       | Exit 0                                                                                  | Full maintainer chain passes                                              |
| `git archive --format=tar HEAD \| tar -t \| grep -E '^\.env$  | ^\.git/'`                                                                               | No matches                                                                | Git archive excludes untracked `.env` and `.git/` |
| Simulated bad archive (`bad-archive.zip` with `.env`)         | `release:verify` exit 1                                                                 | Forbidden `.env`, missing required files, secret heuristic triggered      |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Exit 0, 9/9                                                                             | Policy unit tests pass                                                    |
| `npm run build`                                               | Exit 0                                                                                  | All entrypoints compile                                                   |
| `npm run lint`                                                | Exit 0                                                                                  | Full-repo lint gate passes                                                |
| `npm run test:unit`                                           | Exit -1073741819 (1st attempt); `npx jest --config jest.unit.config.ts` exit 0, 115/115 | Full unit suite passes (115 = 106 existing + 9 new)                       |

## Command results

- **Release ZIP:** `git archive`-based artifact verified clean — no `.env`, `.git/`, `node_modules/`, `dist/`, keys, or dumps; includes `.env.example`.
- **Bad archive simulation:** verify script correctly rejects naive ZIP containing `.env`.
- **Build / lint / unit tests:** all pass with runtime evidence.
- **`.gitattributes export-ignore`:** takes effect once `.gitattributes` is committed; `git archive HEAD` against the pre-merge commit still lists agent workflow dirs (allowed by deny manifest; excluded after merge).

## Acceptance criteria self-check

| Criterion                                                                         | Status                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------ |
| `npm run release:check` produces and validates ZIP in one step                    | Met                                        |
| Release ZIP never contains `.env`, `.git/`, `node_modules/`, `dist/`, keys, dumps | Met                                        |
| Release ZIP includes tracked `.env.example` with dev placeholders only            | Met                                        |
| Packaging uses `git archive` + `.gitattributes export-ignore`                     | Met (export-ignore active after commit)    |
| CI runs gitleaks + artifact manifest verification                                 | Met (workflow added; not executed locally) |
| `.dockerignore` checked automatically for core deny entries                       | Met                                        |
| README documents safe release process                                             | Met                                        |
| Unit tests cover policy/matching logic                                            | Met                                        |

## Remaining risks

1. **`.gitattributes` not yet on `main`** — export-ignore for `.husky/` and agent workflow dirs applies only after this change is merged; until then archives from old commits still ship those paths (not secret-bearing, but broader than target consumer ZIP).
2. **Secret heuristics** — lightweight regex/entropy scan may miss novel secret formats or false-positive on unusual placeholder values outside the allowlist.
3. **gitleaks in CI** — workflow added but not executed in this environment; first run may need `.gitleaks.toml` tuning if historical docs trigger findings.
4. **Operational note for baseline `(45).zip` consumers** — anyone who received the old archive with `.env` should rotate secrets that were in that file.

## Unverified areas

- GitHub Actions `release-artifact.yml` execution on PR (requires push to remote CI).
- **V-13 manual:** `docker compose -f docker-compose.prod.yml build` (Docker daemon unavailable in review environment).
- `npm run test:unit` via npm script intermittently crashed on Windows (`exit -1073741819`); direct `npx jest` succeeded with full suite.
