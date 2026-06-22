---
issue_id: P2-15
status: approved
owner: human-approval-required
---

# P2-15 — Fix `release:check` false-positive secret scan

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § **P2-15. Виправити `release:check` false-positive secret scan** (Medium, Confirmed defect).

Related verification scenario: backlog **V-21** (`npm run release:check` passes while still catching real secret artifacts).

## Investigation notes (2026-06-22)

**Branch:** `main` (uncommitted backlog doc updates only; production code unchanged).

**Defect status:** **Confirmed — not stale.**

**Evidence commands (planner run):**

| Command                                                               | Result                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run release:check` (after `npm ci`)                              | **Exit 1** — verify step reports secret findings in `scripts/release/release-policy.spec.ts`         |
| `npm run release:check-dockerignore`                                  | Exit 0                                                                                               |
| `npm run release:archive`                                             | Exit 0 — archive created at `dist/release/nestjs-backend-foundation-starter-1.0.0.zip` (391 entries) |
| `git archive --format=tar HEAD \| tar -t \| grep release-policy.spec` | `scripts/release/release-policy.spec.ts` present in archive                                          |

Verify failure output:

```text
Potential secret patterns detected:
  - [aws-access-key] Possible AWS access key id in scripts/release/release-policy.spec.ts
  - [private-key-block] Private key block in scripts/release/release-policy.spec.ts
```

**Cross-file scan:** Only `scripts/release/release-policy.spec.ts` contains contiguous AWS key / private-key-block literals. Other tracked files with secret-like strings (`env.schema.spec.ts`, `.env.example`) are already allowlisted by `scanTextForSecrets()` placeholder rules.

**P2-10 boundary:** `.gitattributes` export-ignore excludes `.husky/`, `docs/agent-plans/`, `docs/agent-reports/` only. P2-10 explicitly deferred excluding `**/*.spec.ts` from consumer ZIPs; tests remain in the distributable starter kit.

## Current behavior

1. `npm run release:check` runs: `release:check-dockerignore` → `release:archive` → `release:verify`.
2. `scripts/release/build-archive.ts` produces a ZIP via `git archive HEAD` (or `RELEASE_GIT_REF`).
3. `scripts/release/verify-archive.ts` scans archive member contents for secret patterns when the path matches `\.(env|example|md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|sh|properties)$`.
4. `scripts/release/release-policy.spec.ts` is tracked, included in `git archive`, and contains intentional scanner test fixtures:

```typescript
'AWS_KEY=AKIAIOSFODNN7EXAMPLE\n-----BEGIN PRIVATE KEY-----\n';
```

5. `scanTextForSecrets()` in `scripts/release/release-policy.ts` matches `SECRET_CONTENT_PATTERNS` (`aws-access-key`, `private-key-block`) against raw file text.
6. Verify step exits 1 even though forbidden-path checks and required-file checks pass.
7. GitHub Actions workflow `.github/workflows/release-artifact.yml` runs the same `npm run release:check` on every PR/push — CI would fail for the same reason.

## Confirmed root cause

Release verify performs a **content-level secret scan on all archived `.ts` files**, including unit-test sources. The release-policy unit test embeds **literal high-confidence secret patterns** as fixtures to prove `scanTextForSecrets()` works. The verify step and the policy unit test therefore **contradict each other**: the test validates detection; the archive verifier flags the test file itself.

This is not a P2-10 artifact-hygiene regression (`.env`/`.git` deny rules are separate and still pass).

## Dependency/runtime flow

```text
npm run release:check
  -> release:check-dockerignore
       -> scripts/release/dockerignore-policy.ts
            -> validateDockerignorePolicy()  [passes]
  -> release:archive
       -> scripts/release/build-archive.ts
            -> git archive --format=zip HEAD
                 -> includes scripts/release/release-policy.spec.ts
  -> release:verify
       -> scripts/release/verify-archive.ts
            -> for each ZIP entry:
                 -> isForbiddenArchivePath()        [passes for spec file]
                 -> extension filter includes .ts
                 -> scanTextForSecrets(content, path)  [FAIL on spec fixtures]
            -> exit 1

Parallel CI path:
  .github/workflows/release-artifact.yml
    -> npm run release:check  [blocked by same failure]
    -> gitleaks/gitleaks-action  [separate; .gitleaks.toml does not allowlist spec fixtures]
```

**Symbols on the defect path:**

| Path                                     | Symbol / responsibility                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/release/release-policy.ts`      | `scanTextForSecrets()`, `SECRET_CONTENT_PATTERNS`, placeholder allowlists |
| `scripts/release/verify-archive.ts`      | `verifyArchive()` content-scan loop (lines 133–149)                       |
| `scripts/release/release-policy.spec.ts` | `describe('scanTextForSecrets')` fixture literals                         |
| `scripts/release/build-archive.ts`       | `git archive` packaging (includes all tracked non-export-ignore paths)    |
| `.gitattributes`                         | `export-ignore` (does not exclude `*.spec.ts`)                            |

## Goal

Make `npm run release:check` pass on a clean tree **without weakening** P2-10 forbidden-path / required-file gates or reducing detection of real secrets in production-facing archive members.

## Scope

1. Resolve the policy-test vs verify-archive contradiction using a **two-layer fix** (recommended):
   - **Layer A:** Add explicit secret-scan skip policy for test-only archive paths (`*.spec.ts`, `*.int-spec.ts`).
   - **Layer B:** Rewrite `release-policy.spec.ts` fixtures so source literals no longer contain contiguous secret patterns (defense in depth).
2. Extend `release-policy.spec.ts` with unit coverage for the new skip helper.
3. Add a regression assertion that non-test `.ts` paths still produce findings (proves scanner not globally disabled).

## Out of scope

- Changing P2-10 forbidden-path manifest (`FORBIDDEN_*`, `REQUIRED_ARCHIVE_ENTRIES`).
- Broad `export-ignore` for all `**/*.spec.ts` (P2-10 human decision was to keep tests in consumer ZIP).
- Modifying `.gitleaks.toml` or gitleaks CI behavior (separate tool; not blocking `release:verify` today).
- Rewriting unrelated unit tests (`env.schema.spec.ts`, etc.) — already allowlisted.
- Adding new npm dependencies.
- README changes (behavior unchanged for consumers; optional one-line maintainer note only if human requests).

## Files to create

| Path     | Responsibility                                 |
| -------- | ---------------------------------------------- |
| _(none)_ | All changes fit existing release-policy module |

## Files to modify

| Path                                     | Symbol / change                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release/release-policy.ts`      | Add `shouldScanEntryForSecrets(entryPath: string): boolean` — returns `false` for normalized paths ending in `.spec.ts`, `.int-spec.ts`, or `.test.ts`; export for reuse by verify + tests                                                                                                      |
| `scripts/release/verify-archive.ts`      | In `verifyArchive()` content-scan loop, skip entries where `shouldScanEntryForSecrets(normalizedPath)` is `false` before calling `scanTextForSecrets()`                                                                                                                                         |
| `scripts/release/release-policy.spec.ts` | Rewrite `scanTextForSecrets` positive fixture using runtime string assembly (e.g. `'AKIA' + 'IOSFODNN7EXAMPLE'`, split private-key marker); add tests for `shouldScanEntryForSecrets()`; add test that assembled fixture still triggers findings when passed directly to `scanTextForSecrets()` |

## Files to delete

| Path     | Reason |
| -------- | ------ |
| _(none)_ |        |

## Contract and DI changes

None. Release tooling only; no NestJS modules, ports, tokens, or runtime API changes.

## Implementation steps

1. **Add skip helper in `release-policy.ts`**
   - Implement `shouldScanEntryForSecrets(entryPath: string): boolean`.
   - Normalize path via existing `normalizeArchivePath()`.
   - Return `false` when basename matches `/\.(spec|int-spec|test)\.ts$/i`.
   - Return `true` for all other paths (including `.env.example`, application source, config files).

2. **Wire skip into `verify-archive.ts`**
   - Import `shouldScanEntryForSecrets`.
   - After extension filter, before `extractEntryBuffer` / `scanTextForSecrets`, `continue` when skip helper returns `false`.
   - Keep existing `CONTENT_SCAN_MAX_BYTES` guard and extension filter unchanged.

3. **Harden `release-policy.spec.ts` fixtures**
   - Replace line ~70 literal:
     ```typescript
     const sample = [
       'AWS_KEY=',
       'AKIA',
       'IOSFODNN7EXAMPLE',
       '\n-----BEGIN ',
       'PRIVATE KEY-----\n',
     ].join('');
     ```
   - Assert `scanTextForSecrets(sample, 'secrets.txt')` still finds both pattern IDs (proves scanner unchanged).
   - Assert `scanTextForSecrets` on the **source file path** would not be invoked in verify (covered by skip-helper tests instead).

4. **Add unit tests for skip policy**
   - `shouldScanEntryForSecrets('scripts/release/release-policy.spec.ts')` → `false`
   - `shouldScanEntryForSecrets('libs/infrastructure/src/config/env.schema.spec.ts')` → `false`
   - `shouldScanEntryForSecrets('apps/api/src/main.ts')` → `true`
   - `shouldScanEntryForSecrets('.env.example')` → `true`

5. **Sanity-check P2-10 gates unchanged**
   - Confirm `isForbiddenArchivePath('.env')` still true.
   - Confirm `REQUIRED_ARCHIVE_ENTRIES` still satisfied.
   - Confirm `.gitattributes` untouched.

## Migration and rollout concerns

None. Tooling-only change; no database, env, or deployment migration. Takes effect immediately on merge; no consumer runtime impact.

## Targeted verification

| Command                                                       | Expected result                                    |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Exit 0 — skip-helper + scanner behavior tests pass |
| `npm run release:verify` (after archive exists)               | Exit 0 — no secret findings                        |
| `npm run release:check`                                       | Exit 0 — full chain passes                         |

**Manual negative check (implementer):** Temporarily add a contiguous `AKIA…` literal to a non-test tracked file (e.g. comment in `scripts/release/release-policy.ts`), run `release:archive` + `release:verify`, confirm exit 1, then revert before commit.

## Full verification

| Command                                                       | Expected result                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run release:check`                                       | Exit 0 on clean tree (V-21 primary gate)                      |
| `npm run lint`                                                | Exit 0 (changed files only if lint covers `scripts/release/`) |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Exit 0                                                        |

**Not required for this issue:** `npm run build` (no application code changed). Full `npm run test:unit` optional; release-policy spec is isolated.

## Acceptance criteria

- [ ] `npm run release:check` passes on a clean tree.
- [ ] Release scanner still flags real secret patterns in non-test archive members (manual negative check or unit test simulating production path).
- [ ] P2-10 forbidden-path rules still reject `.env`, `.git/`, `node_modules/`, etc.
- [ ] P2-10 required files (`.env.example`, `package.json`, `Dockerfile`, `.dockerignore`) still enforced.
- [ ] `release-policy.spec.ts` fixtures and verify skip policy are aligned — no contradictory failure mode.
- [ ] Test sources may remain in the release ZIP (P2-10 decision preserved).

## Risks

| Risk                                                                                   | Mitigation                                                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Skipping all `*.spec.ts` hides a real secret accidentally committed in a test file     | Low likelihood; gitleaks still scans repo in CI; skip limited to archive verify content scan; production `.ts` still scanned |
| Future test file uses non-standard suffix (e.g. `.e2e.ts`) and triggers false positive | Document suffix list in `shouldScanEntryForSecrets`; extend only when a concrete false positive appears                      |
| Fixture rewrite breaks scanner unit test                                               | Keep direct `scanTextForSecrets(assembledString, …)` assertion separate from skip-path tests                                 |

## Rollback strategy

Revert changes to `scripts/release/release-policy.ts`, `scripts/release/verify-archive.ts`, and `scripts/release/release-policy.spec.ts`. `release:check` returns to current failing state; no runtime or data rollback needed.

## Open questions requiring human decision

1. **Skip scope vs fixture-only fix:** This plan uses **both** test-path skip and fixture rewrite. If you prefer the minimal single-file fix only (rewrite fixtures, no skip helper), approve that narrower scope before implementation.
2. **Exclude all `*.spec.ts` from consumer ZIP:** Backlog option 1 would also fix the issue but reverses P2-10’s “keep tests in starter kit” decision. Not recommended unless explicitly re-approved.
3. **gitleaks alignment:** `.gitleaks.toml` does not allowlist `release-policy.spec.ts`. gitleaks may still flag fixtures on PRs independently of `release:verify`. If CI gitleaks failures appear, add a narrow path allowlist in a follow-up (out of P2-15 scope unless observed during verification).
