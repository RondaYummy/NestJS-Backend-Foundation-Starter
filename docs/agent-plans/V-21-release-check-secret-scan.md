---
issue_id: V-21
status: approved
owner: human-approval-required
---

# V-21 — `npm run release:check` passes while still catching real secret artifacts

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-21**:

> `npm run release:check` passes while still catching real secret artifacts

**Linked defect:** **P2-15** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P2-15; implementation plan `docs/agent-plans/P2-15-release-check-secret-scan-false-positive.md`).

**Investigation (2026-06-22, branch `main`):** verification scenario is **not stale**. The underlying release-tooling defect from P2-15 is still present in production code. V-21 cannot return `approved` until P2-15 is implemented and independently verified.

## Current behavior

1. **`npm run release:check`** (`package.json`) runs three steps in sequence:
   - `release:check-dockerignore` → `scripts/release/dockerignore-policy.ts`
   - `release:archive` → `scripts/release/build-archive.ts` (`git archive HEAD`)
   - `release:verify` → `scripts/release/verify-archive.ts`

2. **`release:check-dockerignore` and `release:archive` succeed** on a clean tree (planner run, 2026-06-22).

3. **`release:verify` fails** because `scripts/release/release-policy.spec.ts` is included in the ZIP and contains literal high-confidence secret patterns used as unit-test fixtures:

   ```typescript
   'AWS_KEY=AKIAIOSFODNN7EXAMPLE\n-----BEGIN PRIVATE KEY-----\n';
   ```

4. **`verifyArchive()`** (`scripts/release/verify-archive.ts`, lines 133–149) scans all archive entries whose paths match `\.(env|example|md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|sh|properties)$` and calls `scanTextForSecrets()` with no test-file skip policy.

5. **`scanTextForSecrets()`** (`scripts/release/release-policy.ts`, lines 150–201) matches `SECRET_CONTENT_PATTERNS` (`aws-access-key`, `private-key-block`) against raw file text. There is no `shouldScanEntryForSecrets()` helper in the current codebase.

6. **Expected verify failure output** (documented in P2-15 plan; same root cause):

   ```text
   Potential secret patterns detected:
     - [aws-access-key] Possible AWS access key id in scripts/release/release-policy.spec.ts
     - [private-key-block] Private key block in scripts/release/release-policy.spec.ts
   ```

7. **P2-10 artifact hygiene gates remain intact** — forbidden-path checks (`.env`, `.git/`, `node_modules/`, etc.) and required-file checks (`.env.example`, `package.json`, `Dockerfile`, `.dockerignore`) are separate from the content scan and were passing before the secret-scan step failed.

8. **CI path blocked:** `.github/workflows/release-artifact.yml` runs `npm run release:check` on every push/PR; the same verify failure would fail CI after archive creation.

9. **Historical note:** P2-10 verification (`docs/agent-reports/P2-10-verification.md`) reported `release:check` exit 0 at implementation time. The current contradiction between policy unit-test fixtures and archive verify is the confirmed P2-15 defect scope — not a P2-10 regression in forbidden-path rules.

## Confirmed root cause

Release verify performs a **content-level secret scan on all archived `.ts` files**, including unit-test sources. The release-policy unit test embeds **literal high-confidence secret patterns** as fixtures to prove `scanTextForSecrets()` works. The verify step and the policy unit test therefore **contradict each other**: the test validates detection; the archive verifier flags the test file itself.

This is distinct from P2-10 artifact hygiene (`.env`/`.git` deny rules), which remain correct.

## Dependency/runtime flow

### Current (broken — V-21 would fail today)

```text
npm run release:check
  -> release:check-dockerignore     [passes]
  -> release:archive
       -> git archive HEAD
            -> includes scripts/release/release-policy.spec.ts
  -> release:verify
       -> for each ZIP entry matching extension filter:
            -> scanTextForSecrets(content, path)
                 -> FAIL on release-policy.spec.ts fixtures ❌
       -> exit 1

Parallel CI:
  .github/workflows/release-artifact.yml
    -> npm run release:check  [blocked at verify step]
    -> gitleaks/gitleaks-action  [separate; scans repo, not ZIP]
```

### Expected after P2-15 (V-21 pass condition)

```text
npm run release:check
  -> release:check-dockerignore     [passes]
  -> release:archive                  [passes]
  -> release:verify
       -> shouldScanEntryForSecrets(path) === false for *.spec.ts  [skip]
       -> scanTextForSecrets still runs for production .ts paths ✓
       -> exit 0 ✓

Negative control:
  contiguous AKIA… literal in non-test tracked .ts
    -> release:verify exit 1 ✓  (scanner not weakened)
```

**Symbols on the verification path:**

| Path                                     | Symbol / responsibility                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `scripts/release/release-policy.ts`      | `scanTextForSecrets()`, `SECRET_CONTENT_PATTERNS`; **expected:** `shouldScanEntryForSecrets()` |
| `scripts/release/verify-archive.ts`      | `verifyArchive()` content-scan loop                                                            |
| `scripts/release/release-policy.spec.ts` | `describe('scanTextForSecrets')` fixtures + skip-policy tests                                  |
| `scripts/release/build-archive.ts`       | `git archive` packaging                                                                        |
| `.github/workflows/release-artifact.yml` | CI `release:check` gate                                                                        |

## Goal

Independently confirm — with runtime evidence, not static inspection alone — that the official maintainer release gate (`npm run release:check`) passes on a clean tree **and** that the archive secret scanner still detects real secret patterns in non-test archive members after P2-15 is implemented.

## Scope

| Activity                 | Responsibility        | Notes                                                                       |
| ------------------------ | --------------------- | --------------------------------------------------------------------------- |
| Fix false-positive scan  | **P2-15 implementer** | Skip helper + fixture hardening per approved P2-15 plan                     |
| Independent verification | **V-21 verifier**     | Inspect diff, run commands, write `docs/agent-reports/V-21-verification.md` |

## Out of scope

- Implementing the P2-15 fix (separate approved plan).
- Changing P2-10 forbidden-path manifest or broad `export-ignore` for all `*.spec.ts`.
- Modifying `.gitleaks.toml` or gitleaks CI behavior (unless observed failure during V-21 run; document under unverified areas).
- NestJS application code, runtime entrypoints, or DI changes.
- Marking P2-15 or V-21 resolved in backlog INDEX without implementation + verification evidence.

## Files to create

| File                                      | Symbol / responsibility                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/agent-reports/V-21-verification.md` | Independent verification report (verifier output; not created during planning) |

## Files to modify

None during verification planning. Verifier inspects changes from P2-15:

| File                                     | What to verify                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release/release-policy.ts`      | `shouldScanEntryForSecrets()` exported; skip suffixes `.spec.ts`, `.int-spec.ts`, `.test.ts`; `scanTextForSecrets()` unchanged                                        |
| `scripts/release/verify-archive.ts`      | Content-scan loop calls skip helper before `scanTextForSecrets()`                                                                                                     |
| `scripts/release/release-policy.spec.ts` | Fixtures use runtime string assembly (no contiguous literals in source); skip-helper unit tests; direct `scanTextForSecrets(assembledString, …)` still finds patterns |

## Files to delete

None.

## Contract and DI changes

None. Release tooling only; no NestJS modules, ports, tokens, or runtime API changes.

## Implementation steps

V-21 is a verification issue. Steps below are for the **independent verifier** after P2-15 implementation is complete.

### Prerequisite gate

1. Confirm **P2-15 plan** frontmatter is `status: approved`.
2. Confirm P2-15 implementation exists (inspect `git diff`; read `docs/agent-reports/P2-15-implementation.md` if present, but do not trust it without code inspection).
3. If P2-15 is not implemented, stop and return verdict **`changes-required`** with note: underlying defect still open.

### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm only P2-15-scoped files changed (`release-policy.ts`, `verify-archive.ts`, `release-policy.spec.ts`).
3. Confirm P2-10 symbols untouched:
   - `FORBIDDEN_*`, `REQUIRED_ARCHIVE_ENTRIES` in `release-policy.ts`
   - `.gitattributes` export-ignore rules
   - `scripts/release/build-archive.ts` archive mechanism

### Step 2 — Static policy trace

Document the post-fix flow:

```text
verifyArchive()
  -> extension filter (unchanged)
  -> shouldScanEntryForSecrets(normalizedPath)
       -> false for *.spec.ts / *.int-spec.ts / *.test.ts  → skip content scan
       -> true for apps/api/src/main.ts, .env.example, etc. → scanTextForSecrets()
```

Confirm `release-policy.spec.ts` source no longer contains contiguous `AKIA[0-9A-Z]{16}` or `-----BEGIN … PRIVATE KEY-----` literals (grep check).

### Step 3 — Targeted unit verification (mandatory)

```bash
npm ci
npm run test:unit -- scripts/release/release-policy.spec.ts
```

**Expected:** all tests pass, including:

- `shouldScanEntryForSecrets('scripts/release/release-policy.spec.ts')` → `false`
- `shouldScanEntryForSecrets('apps/api/src/main.ts')` → `true`
- `scanTextForSecrets(assembledFixture, 'secrets.txt')` still detects `aws-access-key` and `private-key-block`

### Step 4 — Primary release gate (mandatory)

```bash
npm run release:check
```

**Expected:** exit 0 — full chain (dockerignore → archive → verify) passes on clean tree.

**If Windows npm crash (`exit -1073741819`):** retry individual steps via direct `ts-node` invocations (same pattern as P2-10 verification):

```bash
npx ts-node --project scripts/release/tsconfig.json --transpile-only scripts/release/dockerignore-policy.ts
npx ts-node --project scripts/release/tsconfig.json --transpile-only scripts/release/build-archive.ts
npx ts-node --project scripts/release/tsconfig.json --transpile-only scripts/release/verify-archive.ts
```

Record which invocation path was used. CI runs on Ubuntu where chained `npm run` is the canonical path.

### Step 5 — Negative control: scanner still catches real secrets (mandatory)

Prove the fix does not globally disable secret detection. Use **one** of:

**Option A — unit-level (preferred, no repo mutation):**

Confirm `release-policy.spec.ts` includes a test that passes an assembled secret string to `scanTextForSecrets()` with a **non-test path** (e.g. `secrets.txt` or `apps/api/src/leak.ts`) and asserts findings are non-empty.

**Option B — archive-level (implementer may have run during P2-15; verifier may repeat on disposable branch):**

1. Temporarily add a contiguous `AKIAIOSFODNN7EXAMPLE` literal to a non-test tracked file (e.g. comment in `scripts/release/release-policy.ts`).
2. Run `npm run release:archive && npm run release:verify`.
3. **Expected:** exit 1 with secret finding on the non-test path.
4. Revert before committing verification report.

### Step 6 — P2-10 regression checks (mandatory)

After successful `release:archive`, confirm P2-10 gates still hold:

| Check                               | Method                                                         | Pass condition                                                |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Forbidden paths absent              | Inspect verify stdout / parse ZIP entries                      | No `.env`, `.git/`, `node_modules/`, `dist/`                  |
| Required files present              | verify stdout                                                  | `.env.example`, `package.json`, `Dockerfile`, `.dockerignore` |
| `.env.example` placeholders allowed | `scanTextForSecrets` on archived `.env.example` or unit test   | No false positives on `dev-secret` placeholders               |
| Test sources may remain in ZIP      | `git archive --format=tar HEAD \| tar -t \| grep '\.spec\.ts'` | Spec files present (P2-10 decision preserved)                 |

### Step 7 — Lint (when release scripts changed)

```bash
npm run lint
```

Record exit code. Release script changes are tooling-only; full `npm run build` not required unless lint/build scope includes `scripts/release/`.

### Step 8 — Write verification report

Create `docs/agent-reports/V-21-verification.md` using structure from `.cursor/skills/change-verification/SKILL.md`:

```markdown
# V-21 — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Scope checked

## Root-cause assessment

## Acceptance criteria matrix

## Dependency and DI verification

## Commands executed

## Findings

## Documentation alignment

## Remaining risks

## Unverified areas
```

Include per-command records:

```text
Command:
Result:
Conclusion:
```

## Migration and rollout concerns

None for verification. P2-15 fix is tooling-only; no database, env, or deployment migration.

## Targeted verification

| Command                                                       | Expected result                              |
| ------------------------------------------------------------- | -------------------------------------------- |
| `npm ci`                                                      | Clean install succeeds                       |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Passes; skip helper + scanner behavior       |
| `npm run release:check`                                       | Exit 0 — primary V-21 evidence               |
| Negative control (Step 5)                                     | Scanner still flags non-test secret patterns |

## Full verification

| Command                                                       | Expected result                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run release:check`                                       | Exit 0 on clean tree                                                                           |
| `npm run lint`                                                | Exit 0 or only pre-existing unrelated failures documented                                      |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Exit 0                                                                                         |
| `.github/workflows/release-artifact.yml`                      | Static review confirms `npm run release:check` step present; runtime CI pass noted if observed |

**Not required for this issue:** `npm run build` (no application code changed).

## Acceptance criteria

| ID   | Criterion                                               | Verification method                                   | Pass condition                                                             |
| ---- | ------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| AC-1 | P2-15 fix implemented and scoped correctly              | Diff + scope review                                   | Only planned release-tooling files changed                                 |
| AC-2 | `npm run release:check` passes on clean tree            | Execute Step 4                                        | Exit 0                                                                     |
| AC-3 | False positive from `release-policy.spec.ts` eliminated | `release:check` + grep source for contiguous literals | Verify no longer flags spec file; source has no contiguous secret literals |
| AC-4 | Scanner still detects real secret patterns              | Step 5 negative control                               | Findings on non-test path or assembled-string unit test                    |
| AC-5 | P2-10 forbidden-path rules unchanged                    | Step 6 + code review                                  | `.env`, `.git/`, etc. still rejected                                       |
| AC-6 | P2-10 required files still enforced                     | verify stdout                                         | All `REQUIRED_ARCHIVE_ENTRIES` present                                     |
| AC-7 | Policy test and verify aligned                          | Static trace + full chain                             | No contradictory failure mode                                              |
| AC-8 | Test sources may remain in release ZIP                  | Archive entry inspection                              | `*.spec.ts` present unless human re-approved P2-10 scope change            |
| AC-9 | `npm run lint` passes                                   | Execute and record                                    | Exit 0 or documented pre-existing failures                                 |

**Verdict rules:**

- **`approved`** — AC-1 through AC-9 pass; negative control (AC-4) executed with evidence.
- **`changes-required`** — any of AC-1–AC-7 fail, or scanner globally disabled, or P2-10 gates regressed.
- **`not-confirmed`** — `release:check` could not run and direct ts-node retries also failed without infra explanation; or P2-15 not implemented.

## Risks

1. **False approval from unit tests only** — passing `release-policy.spec.ts` without running `release:check` is insufficient; Step 4 is mandatory.
2. **Skip helper too broad** — if skip logic matches non-test paths, real secrets in misnamed files could evade scan; AC-4 negative control guards this.
3. **Windows npm intermittent crashes** — document retry path; Ubuntu CI is canonical (P2-10 precedent).
4. **gitleaks independent failure** — `.gitleaks.toml` does not allowlist `release-policy.spec.ts`; fixture rewrite (P2-15 Layer B) should prevent gitleaks false positives, but gitleaks is out of V-21 scope unless CI fails during verification.
5. **P2-15 not approved/implemented** — V-21 verification blocked until implementation completes.

## Rollback strategy

Verification is read-only. If verdict is `changes-required`, revert to P2-15 implementer — no verifier code changes.

## Open questions requiring human decision

1. **Verification ordering** — must V-21 wait for a separate P2-15 verification report (`docs/agent-reports/P2-15-verification.md`), or is V-21 the canonical release-scan verification for this defect?
2. **Negative control method** — is unit-level assembled-string test (Option A) sufficient for AC-4, or must the verifier run archive-level mutation (Option B)?
3. **CI runtime evidence** — is local `release:check` exit 0 sufficient for `approved`, or must a post-merge GitHub Actions run be observed?
4. **P2-15 plan approval** — P2-15 plan is currently `status: proposed`; confirm human approval before implementation begins.
