---
issue_id: P2-10
status: approved
owner: human-approval-required
---

# P2-10 — Do not include `.env` and `.git` in release archive

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P2-10. Не включати `.env` і `.git` у release archive**.

Related verification scenario: backlog **V-13** (Docker dev/prod flows and release artifact manifest/secrets).

## Investigation notes (2026-06-21)

**Branch:** `main` (clean working tree except untracked `docs/agent-plans/*`).

**Defect status:** **Confirmed — not stale.** The repository has no release packaging script, no `.gitattributes`, and no CI workflow that validates distribution artifacts. A local `.env` file exists (gitignored) and would be included by naive directory zipping. The backlog baseline `NestJS-Backend-Foundation-Starter(45).zip` contained `.env` and `.git/`.

**Positive finding:** `git archive HEAD` already excludes `.env`, `.git/`, `node_modules/`, `dist/`, and `coverage/`, and includes tracked `.env.example`. `.dockerignore` already excludes `.env`, `.git`, `node_modules`, and `dist` (see `DOCKER_PRODUCTION.md` line 50).

## Current behavior

1. **No canonical release path.** `package.json` has no `release:archive`, `pack`, or similar script. There is no `scripts/` directory.
2. **Distribution is undocumented.** README §24 says “Скопіювати starter” without prescribing `git archive` or a packaging script. `README_CURSOR_AGENTS.md` mentions unpacking a ZIP but does not define how maintainers should produce it.
3. **Naive zipping includes local secrets and VCS metadata.** Compressing the working directory (Explorer, `Compress-Archive`, `zip -r .`) includes:
   - `.env` — present locally, listed in `.gitignore`, not tracked, but still on disk;
   - `.git/` — full history, remotes, and config;
   - optionally `node_modules/`, `dist/`, `coverage/` if present.
4. **No CI guardrails.** No `.github/workflows/` directory exists. Nothing scans release artifacts for secrets or forbidden paths before publication.
5. **Docker build context is partially protected.** `.dockerignore` excludes `.env` and `.git`, but there is no automated check that required deny patterns remain present after future edits.

**Evidence commands (planner run):**

| Command                                                                 | Result                                  |
| ----------------------------------------------------------------------- | --------------------------------------- |
| `Test-Path .env`                                                        | `.env exists locally`                   |
| `git check-ignore -v .env`                                              | `.gitignore:4:.env` — correctly ignored |
| `git ls-files .env`                                                     | _(empty)_ — not tracked                 |
| `git archive --format=tar HEAD \| tar -t \| grep -E '^(\.env\|\.git/)'` | _(no matches)_                          |
| `git archive --format=tar HEAD \| tar -t \| grep .env.example`          | `.env.example` present                  |

## Confirmed root cause

Release archives were (and would again be) produced by **directory-level compression of the working tree** instead of a **Git-tracked allowlist** (`git archive`) or an explicit packaging script with a deny manifest. Untracked local files (`.env`) and the `.git/` directory are invisible to Git but visible to filesystem zip tools.

## Dependency/runtime flow

```text
Maintainer (manual today)
  -> zip/compress project folder (WRONG)
       -> includes .env, .git/, node_modules?, dist?, coverage?

Maintainer (target)
  -> npm run release:archive
       -> scripts/release/build-archive.mjs
            -> git archive --format=zip HEAD (or tagged ref)
                 -> respects .gitattributes export-ignore
            -> writes dist/release/nestjs-backend-foundation-starter-<version>.zip
       -> scripts/release/verify-archive.mjs (same npm script chain)
            -> deny manifest: .env, .git/, node_modules/, dist/, *.pem, *.key, ...
            -> require .env.example
            -> optional secret-pattern scan on member contents
            -> assert .dockerignore contains required deny entries

Consumer
  -> unzip starter kit
  -> cp .env.example .env
  -> npm ci && npm run build

Docker production build (unchanged flow, verify only)
  -> docker compose -f docker-compose.prod.yml build
       -> Dockerfile COPY . .
       -> .dockerignore excludes .env, .git, node_modules, dist
```

**Symbols / files on the defect path:**

| Path            | Role today                                                       |
| --------------- | ---------------------------------------------------------------- |
| _(none)_        | No packaging entrypoint — gap is the absence of tooling          |
| `.gitignore`    | Ignores `.env` for Git only; does not affect naive zip           |
| `.dockerignore` | Correct for Docker; not used for ZIP distribution                |
| `.env.example`  | Tracked placeholder env; should be the only env file in artifact |

## Goal

Provide a **single, documented, repeatable** release packaging path that ships only intended starter-kit files, **never** `.env`, `.git/`, private keys, dumps, or `node_modules/`, and enforce this with **automated manifest + secret checks** in CI. Confirm `.dockerignore` remains aligned with the same deny policy.

## Scope

1. Add `.gitattributes` with `export-ignore` for dev-only tracked paths that should not ship in consumer ZIPs (minimal set; see implementation steps).
2. Add Node-based release scripts (no new npm dependencies):
   - `scripts/release/build-archive.mjs` — produce ZIP via `git archive`;
   - `scripts/release/verify-archive.mjs` — deny manifest, require `.env.example`, lightweight secret-pattern scan;
   - `scripts/release/dockerignore-policy.mjs` — assert `.dockerignore` contains required patterns (shared policy constants).
3. Add `package.json` scripts:
   - `"release:archive": "node scripts/release/build-archive.mjs"`;
   - `"release:verify": "node scripts/release/verify-archive.mjs"`;
   - `"release:check-dockerignore": "node scripts/release/dockerignore-policy.mjs"`;
   - `"release:check": "npm run release:check-dockerignore && npm run release:archive && npm run release:verify"`.
4. Add GitHub Actions workflow `.github/workflows/release-artifact.yml`:
   - trigger: `push` to `main`, `pull_request`, and optional `workflow_dispatch`;
   - steps: checkout → `npm run release:check` → gitleaks scan on repository (and/or on produced ZIP);
   - fail CI when forbidden paths or high-confidence secrets are detected.
5. Document maintainer release steps in `README.md` §25 (Корисні команди) and a short note in `README_CURSOR_AGENTS.md` (how the distributable ZIP is produced).
6. Add unit tests for `verify-archive` / policy helpers (pure functions extracted for testability).

## Out of scope

- Publishing releases to npm registry (package is `"private": true`).
- Changing `.env.example` content beyond what **P3-03** may require separately.
- Adding real secrets or modifying local `.env`.
- Docker runtime behavior changes (`Dockerfile`, compose services) except documentation cross-reference.
- Full **V-13** Docker bootstrap execution (Docker daemon unavailable in review environment per backlog §1); plan only adds static/CI checks plus manual verification steps.
- Pre-commit hooks that block local `.env` existence (developers legitimately have `.env` locally).
- Excluding test sources (`**/*.spec.ts`) from starter distribution unless human approves a broader export-ignore policy (open question).

## Files to create

| Path                                      | Responsibility                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `.gitattributes`                          | `export-ignore` rules for dev-only tracked paths in `git archive` output                       |
| `scripts/release/build-archive.mjs`       | Run `git archive`, write versioned ZIP under `dist/release/`                                   |
| `scripts/release/verify-archive.mjs`      | Deny manifest, require `.env.example`, scan archive member names and selected content patterns |
| `scripts/release/dockerignore-policy.mjs` | Shared deny patterns; verify `.dockerignore` contains them                                     |
| `scripts/release/release-policy.mjs`      | Shared constants: forbidden path prefixes, secret regexes, required files                      |
| `scripts/release/release-policy.spec.ts`  | Unit tests for policy matching helpers                                                         |
| `.github/workflows/release-artifact.yml`  | CI: build + verify archive, gitleaks, dockerignore policy                                      |

## Files to modify

| Path                      | Change                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `package.json`            | Add `release:archive`, `release:verify`, `release:check-dockerignore`, `release:check` scripts              |
| `README.md`               | §25 — document safe release packaging (`npm run release:check`); warn against zipping the working directory |
| `README_CURSOR_AGENTS.md` | Note that distributable ZIP must be built via `npm run release:archive`, not raw folder compression         |
| `.gitignore`              | Add `dist/release/` (generated ZIP output) if not already covered by `dist`                                 |

## Files to delete

| Path     | Reason |
| -------- | ------ |
| _(none)_ | —      |

## Contract and DI changes

None. This is release tooling and CI only; no NestJS modules, ports, or tokens change.

## Implementation steps

1. **Define shared policy** in `scripts/release/release-policy.mjs`:
   - **Forbidden path prefixes / exact names:** `.env`, `.env.local`, `.git/`, `node_modules/`, `dist/`, `coverage/`, `storage/` (runtime uploads), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.dump`, `*.sql.gz` (dump artifacts — exclude ad-hoc DB dumps; keep tracked Drizzle migrations under `libs/.../migrations/`).
   - **Required entries:** `.env.example`, `package.json`, `Dockerfile`, `.dockerignore`.
   - **Secret heuristics (content scan):** AWS key pattern, `BEGIN PRIVATE KEY`, `JWT_SECRET=` lines that are not the documented dev placeholder, high-entropy assignment heuristics — tuned to minimize false positives on `.env.example` dev placeholders.

2. **Add `.gitattributes`** with conservative `export-ignore` (human-approved list):
   - `.husky/` — git hooks not needed in consumer ZIP;
   - `docs/agent-plans/` and `docs/agent-reports/` — internal agent workflow artifacts (optional; see open questions);
   - do **not** export-ignore application source, migrations, `.cursor/` agent pack, or tests unless explicitly approved.

3. **Implement `build-archive.mjs`:**
   - Resolve ref: `process.env.RELEASE_GIT_REF ?? HEAD` (allow tag for releases).
   - Output: `dist/release/nestjs-backend-foundation-starter-<package.json version>.zip`.
   - Use `git archive --format=zip --output=<path> <ref>`.
   - Exit non-zero if `git archive` fails (shallow clone / missing ref).

4. **Implement `verify-archive.mjs`:**
   - Accept ZIP path arg or default to latest in `dist/release/`.
   - List entries (use Node built-in or minimal `yauzl`-free approach: spawn `tar`/`unzip -l` on Unix, PowerShell `Expand-Archive` listing or parse ZIP central directory in pure Node to avoid new dependencies).
   - Fail on forbidden paths (normalize separators, reject `../` traversal in names).
   - Assert `.env.example` present; assert `.env` absent.
   - Run content scan on text members under size cap (e.g. 256 KiB) for secret patterns.
   - Print manifest summary (entry count, key files) for **V-13** evidence.

5. **Implement `dockerignore-policy.mjs`:**
   - Read `.dockerignore`; assert lines (or equivalent patterns) exist for: `.git`, `.env`, `.env.*` with exception handling for `.env.example`, `node_modules`, `dist`.
   - Reuse constants from `release-policy.mjs`.

6. **Wire npm scripts** in `package.json` as listed in Scope.

7. **Add `.github/workflows/release-artifact.yml`:**
   - Job `release-artifact-check`: `npm run release:check`.
   - Job or step `gitleaks`: use `gitleaks/gitleaks-action@v2` with `--no-git` scan of produced ZIP or standard repo scan; configure to fail on findings.
   - Permissions: `contents: read` only.

8. **Documentation:**
   - README §25: add `npm run release:check` for maintainers; explicit warning: do not use Explorer/`Compress-Archive` on the repo root.
   - README_CURSOR_AGENTS.md: align “розпакуйте ZIP” with maintainer build command.

9. **Unit tests:** `scripts/release/release-policy.spec.ts` — forbidden path detection, required file checks, dockerignore line matching.

## Migration and rollout concerns

- **Existing consumers** who received baseline `(45).zip` may already have been exposed to `.env` and git remotes metadata; recommend rotating any secrets that were in a shipped `.env` (operational note in implementation report, not code).
- **Shallow CI clones:** `git archive HEAD` works on shallow clones; tagging releases should use `RELEASE_GIT_REF=vX.Y.Z`.
- **Windows maintainers:** `git archive` is available with Git for Windows; Node scripts must not assume Unix-only shell.
- **Generated output:** `dist/release/*.zip` is gitignored via `dist/`; CI produces ephemeral artifacts.

## Targeted verification

| Command / scenario                                             | Expected result                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm run release:check-dockerignore`                           | Exit 0; confirms `.dockerignore` policy                     |
| `npm run release:archive`                                      | Creates ZIP under `dist/release/`                           |
| `npm run release:verify -- dist/release/<zip>`                 | Exit 0; manifest lists `.env.example`; no `.env` or `.git/` |
| Simulate bad archive: manually zip repo root including `.env`  | `release:verify` exits non-zero                             |
| `git archive --format=tar HEAD \| tar -t \| grep -E '^\.env$'` | No match                                                    |
| `npm run test:unit -- scripts/release/release-policy.spec.ts`  | Pass                                                        |

## Full verification

| Command                                                                                    | Expected                                                                                                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                            | Exit 0 (no application code changes expected; run if any shared files touched)                                              |
| `npm run lint`                                                                             | Exit 0                                                                                                                      |
| `npm run test:unit`                                                                        | Exit 0 including new policy tests                                                                                           |
| GitHub Actions `release-artifact.yml` on PR                                                | Workflow passes gitleaks + `release:check`                                                                                  |
| **V-13 manual (when Docker available):** `docker compose -f docker-compose.prod.yml build` | Build context excludes `.env`/`.git` (inspect build log / `docker build` context size); not a blocker if Docker unavailable |

## Acceptance criteria

- [ ] Canonical maintainer command `npm run release:check` produces a ZIP and validates it in one step.
- [ ] Release ZIP **never** contains `.env`, `.git/`, `node_modules/`, `dist/`, private key files, or DB dump artifacts per deny manifest.
- [ ] Release ZIP **includes** tracked `.env.example` with non-secret dev placeholders only.
- [ ] Packaging uses **`git archive`** (Git-tracked allowlist) plus `.gitattributes` `export-ignore`, not naive directory compression.
- [ ] CI workflow runs secret scanning (gitleaks) and artifact manifest verification; fails on violations.
- [ ] `.dockerignore` is checked automatically for the same core deny entries (`.env`, `.git`, `node_modules`, `dist`).
- [ ] README documents the safe release process and warns against zipping the working directory.
- [ ] Unit tests cover policy/matching logic used by verify scripts.

## Risks

| Risk                                                                 | Mitigation                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| False positives in secret scanner on `.env.example` dev placeholders | Allowlist known placeholder values (`dev-secret`, `CHANGE_ME_*`); scan only non-example env files if present               |
| `export-ignore` hides files consumers expect (tests, `.cursor/`)     | Start minimal; document exclusions; human approves list                                                                    |
| Pure-Node ZIP parsing complexity on Windows                          | Use small, tested ZIP directory reader or invoke `git archive` + verify via `tar -t` where available; fallback Node parser |
| gitleaks noise on historical docs                                    | Scope gitleaks to release ZIP or use `.gitleaks.toml` allowlist for known example secrets in `.env.example`                |
| Shallow clone / missing tags in CI                                   | Default `HEAD`; document tag-based releases                                                                                |

## Rollback strategy

- Remove or disable `.github/workflows/release-artifact.yml`.
- Remove `release:*` npm scripts and `scripts/release/` directory.
- Revert `.gitattributes` if export-ignore causes maintainer confusion.
- No runtime or database rollback required.

## Open questions requiring human decision

1. **`export-ignore` scope:** Should consumer ZIP exclude internal agent workflow dirs (`docs/agent-plans/`, `docs/agent-reports/`), `.husky/`, and/or `**/*.spec.ts`? Recommendation: exclude `.husky/` and agent plans/reports only; **keep tests** in the starter kit.
2. **CI platform:** Plan assumes GitHub Actions (no existing CI in repo). Confirm target platform or accept workflow as template for other CI.
3. **gitleaks configuration:** Approve third-party `gitleaks/gitleaks-action` vs. repo-only custom pattern scan (lighter, no external action).
4. **Archive naming/versioning:** Use `package.json` `version` only, or require git tag (`RELEASE_GIT_REF`) for published ZIPs?
5. **Storage directory:** Deny `storage/` in release ZIP (local uploads) — confirm no legitimate tracked files under `storage/` need to ship (currently runtime-only).
