# P2-10 — Independent verification

## Verdict

**approved**

## Scope checked

Verified against:

- Source issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-10**
- Approved plan: `docs/agent-plans/P2-10-exclude-env-git-release-archive.md` (`status: approved`)
- Implementation report: `docs/agent-reports/P2-10-implementation.md`
- Staged diff: 14 files (release tooling, CI, docs only)

**In scope:** `.gitattributes`, `.github/workflows/release-artifact.yml`, `.gitleaks.toml`, `scripts/release/*`, `package.json` release scripts, `README.md`, `README_CURSOR_AGENTS.md`, `.gitignore`.

**Out of scope / unchanged:** NestJS application code, infrastructure modules, DI, contracts, runtime entrypoints. No unrelated backlog issues mixed in.

**Documented deviations (justified):**

| Plan                      | Actual                          | Assessment                                                          |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| Release scripts as `.mjs` | `.ts` run via `ts-node`         | Justified — shared policy testable by Jest without new dependencies |
| —                         | `scripts/release/tsconfig.json` | Justified — ts-node compile scope outside Nest app tsconfig         |

## Root-cause assessment

**Confirmed and addressed.**

The original defect was release archives produced by **filesystem-level compression** of the working tree, which included untracked `.env` and the `.git/` directory despite correct `.gitignore` / `.dockerignore` settings.

The implementation replaces that path with:

1. `git archive` (Git-tracked allowlist) in `scripts/release/build-archive.ts`
2. `.gitattributes` `export-ignore` for dev-only tracked paths
3. `scripts/release/verify-archive.ts` deny manifest + required-file checks + lightweight secret scan
4. `scripts/release/dockerignore-policy.ts` alignment check for `.dockerignore`
5. CI workflow running `npm run release:check` and gitleaks

This fixes the root cause rather than suppressing symptoms.

## Acceptance criteria matrix

| #   | Criterion                                                                         | Status                                            | Evidence                                                                             |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `npm run release:check` produces and validates ZIP in one step                    | **passed**                                        | Subagent retry exit 0; verifier confirmed dockerignore → archive → verify chain      |
| 2   | Release ZIP never contains `.env`, `.git/`, `node_modules/`, `dist/`, keys, dumps | **passed**                                        | ZIP parse: 429 entries; forbidden list empty; `release:verify` exit 0                |
| 3   | Release ZIP includes tracked `.env.example` with dev placeholders                 | **passed**                                        | `.env.example` present in ZIP; secret scan allows documented dev placeholders        |
| 4   | Packaging uses `git archive` + `.gitattributes export-ignore`                     | **passed**                                        | `build-archive.ts` calls `git archive`; `.gitattributes` defines export-ignore rules |
| 5   | CI runs gitleaks + artifact manifest verification                                 | **passed** (static) / **not-confirmed** (runtime) | Workflow file present and correct; first CI run not executed in this environment     |
| 6   | `.dockerignore` checked automatically for core deny entries                       | **passed**                                        | `release:check-dockerignore` / direct `dockerignore-policy.ts` exit 0                |
| 7   | README documents safe release process                                             | **passed**                                        | README §25 adds `release:check` and warns against naive zipping                      |
| 8   | Unit tests cover policy/matching logic                                            | **passed**                                        | `release-policy.spec.ts`: 9/9 tests pass                                             |

## Dependency and DI verification

**N/A.** Release tooling and CI only. No NestJS modules, ports, tokens, providers, or composition roots changed.

## Commands executed

| Command                                                              | Result                                              | Conclusion                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `npx ts-node ... dockerignore-policy.ts`                             | Exit 0                                              | `.dockerignore` policy passes                                       |
| `git archive --format=zip ... HEAD`                                  | Exit 0                                              | Archive builds successfully                                         |
| Node ZIP entry inspection                                            | 429 entries; `.env.example` present; forbidden `[]` | No `.env`, `.git/`, `node_modules/`, `dist/` in artifact            |
| `npx ts-node ... verify-archive.ts` (earlier run)                    | Exit 0                                              | Manifest verification passed                                        |
| `npm run release:check-dockerignore`                                 | Exit -1073741819 (Windows)                          | Intermittent npm/ts-node crash; direct ts-node invocation succeeded |
| `npm run test:unit -- scripts/release/release-policy.spec.ts`        | Exit 0, 9/9                                         | Policy unit tests pass                                              |
| `npm run build`                                                      | Exit 0                                              | All entrypoints compile                                             |
| `npm run lint`                                                       | Exit 0                                              | Full-repo lint passes                                               |
| `git archive --format=tar HEAD \| tar -t` grep `^\.env$` / `^\.git/` | No matches                                          | Git archive excludes untracked `.env` and `.git/`                   |

**Not re-run:** Bad-archive negative simulation (implementer reported exit 1; `verify-archive.ts` logic inspected and supports rejection).

## Findings

**Strengths**

- Canonical maintainer path: `npm run release:check`
- Shared policy in `release-policy.ts` reused by verify, dockerignore check, and tests
- Pure-Node ZIP reader in `verify-archive.ts` (Windows-compatible)
- Documentation aligned in README and README_CURSOR_AGENTS.md
- `.gitleaks.toml` allowlists documented `.env.example` placeholders

**Minor non-blocking notes**

1. **Intermittent Windows npm crashes** (`exit -1073741819`) on some chained `npm run` invocations; direct `ts-node` and subagent retries succeed. CI runs on Ubuntu.
2. **`.gitattributes` export-ignore** takes full effect once this commit is the archived ref; archives from pre-merge `HEAD` may still include `.husky/` and `docs/agent-*` (not secret-bearing, broader than target consumer ZIP).
3. **gitleaks scans the repository**, not the produced ZIP specifically. Plan allowed either approach; manifest verification covers the artifact.

## Documentation alignment

- README §25 documents `npm run release:check`, individual release steps, `RELEASE_GIT_REF`, and explicit warning against zipping the working directory.
- README_CURSOR_AGENTS.md instructs maintainers to build distributable ZIP via `npm run release:archive` / `release:check`.
- Aligns with approved plan and P2-10 issue requirements.

## Remaining risks

| Risk                                                                               | Severity              |
| ---------------------------------------------------------------------------------- | --------------------- |
| First GitHub Actions run may need `.gitleaks.toml` tuning                          | Low                   |
| Secret heuristics may miss novel formats or false-positive on unusual placeholders | Low                   |
| Baseline `(45).zip` consumers should rotate any secrets from shipped `.env`        | Operational           |
| **V-13** manual Docker prod build not executed (Docker unavailable)                | Out of scope per plan |

## Unverified areas

- GitHub Actions `release-artifact.yml` execution on push/PR (requires remote CI)
- Bad-archive negative test not re-run in verifier environment
- `docker compose -f docker-compose.prod.yml build` context inspection (V-13 manual)
