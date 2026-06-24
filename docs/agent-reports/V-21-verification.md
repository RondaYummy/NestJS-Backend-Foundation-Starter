# V-21 — Independent verification

## Verdict

**approved**

## Scope checked

**Plan status:** `docs/agent-plans/V-21-release-check-secret-scan.md` — `status: approved` ✓

**Linked defect:** **P2-15** (`docs/agent-plans/P2-15-release-check-secret-scan-false-positive.md` — `status: approved`; committed at `7d617ed`).

**Git state (verifier run, 2026-06-24):** No production code changes in this session. P2-15-scoped files are on `HEAD`:

| Path | Role | In plan? |
| ---- | ---- | -------- |
| `scripts/release/release-policy.ts` | `shouldScanEntryForSecrets()` + unchanged `scanTextForSecrets()` | Yes |
| `scripts/release/verify-archive.ts` | Skip secret scan for test-only paths | Yes |
| `scripts/release/release-policy.spec.ts` | Runtime-assembled fixtures + skip/scanner tests | Yes |

**Out-of-scope files:** No changes to `.gitattributes`, `FORBIDDEN_*`, `REQUIRED_ARCHIVE_ENTRIES`, `build-archive.ts`, dockerignore policy, NestJS apps/libs, or `.gitleaks.toml`.

**Working tree note:** Unrelated local doc changes (`docs/agent-backlog/INDEX.md` staged deletion, `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` edits for baseline 53) do not affect this verdict.

## Root-cause assessment

**Original defect (confirmed):** `verify-archive.ts` content-scanned all archived `.ts` files via `scanTextForSecrets()`. `release-policy.spec.ts` embedded contiguous AWS access-key and private-key-block literals to test the scanner. Verify and the unit test contradicted each other — verify flagged the test file as a secret.

**Fix addresses root cause (P2-15, verified on branch):**

1. **Layer A — skip policy:** `shouldScanEntryForSecrets()` returns `false` for basenames matching `/\.(spec|int-spec|test)\.ts$/i`, wired in `verifyArchive()` after the extension filter and before content extraction/scanning.
2. **Layer B — fixture hardening:** Spec file literals split and joined at runtime; grep confirms no `AKIAIOSFODNN7EXAMPLE` or contiguous `AKIA[0-9A-Z]{16}` / `BEGIN PRIVATE KEY` literals in `release-policy.spec.ts`.

**Post-fix flow (static trace):**

```text
verifyArchive()
  -> extension filter (unchanged)
  -> shouldScanEntryForSecrets(normalizedPath)
       -> false for *.spec.ts / *.int-spec.ts / *.test.ts  → skip content scan
       -> true for apps/api/src/main.ts, .env.example, etc. → scanTextForSecrets()
```

P2-10 forbidden-path and required-file gates are untouched.

## Acceptance criteria matrix

| ID | Criterion | Status | Evidence |
| -- | --------- | ------ | -------- |
| AC-1 | P2-15 fix implemented and scoped correctly | **passed** | Commit `7d617ed` touches only P2-15 release-tooling files (+ P2-15 reports); no unrelated production diffs |
| AC-2 | `npm run release:check` passes on clean tree | **passed** | Decomposed `node node_modules/ts-node/dist/bin.js` chain exit 0 for dockerignore → archive → verify (402 entries, required files yes). Chained `npm run release:check` / first `npm run test:release` attempt hit Windows exit `-1073741819` (environment, not policy defect) — per plan Step 4 fallback |
| AC-3 | False positive from `release-policy.spec.ts` eliminated | **passed** | `verify-archive.ts` exit 0 — no secret findings; grep shows no contiguous secret literals in spec source |
| AC-4 | Scanner still detects real secret patterns | **passed** | Unit test `still flags secrets on non-test archive paths` passes assembled patterns through `scanTextForSecrets(..., 'apps/api/src/main.ts')` and asserts `aws-access-key` and `private-key-block` (Option A negative control) |
| AC-5 | P2-10 forbidden-path rules unchanged | **passed** | No diff to `FORBIDDEN_*` constants or `isForbiddenArchivePath()`; existing unit tests pass (12/12) |
| AC-6 | P2-10 required files still enforced | **passed** | Verify output: `Required files present: yes` |
| AC-7 | Policy test and verify aligned | **passed** | Full verify chain passes; skip helper excludes `*.spec.ts` while scanner unit tests still validate detection |
| AC-8 | Test sources may remain in release ZIP | **passed** | `git archive --format=tar HEAD \| tar -t` lists `scripts/release/release-policy.spec.ts`; P2-10 packaging unchanged |
| AC-9 | `npm run lint` passes | **passed** | Exit 0 |

## Dependency and DI verification

Not applicable. Release tooling only; no NestJS tokens, providers, modules, or runtime entrypoint changes.

## Commands executed

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npm run test:release -- scripts/release/release-policy.spec.ts` | Exit `-1073741819` (first attempt) | Windows npm intermittent crash; retried via direct jest |
| `node node_modules/jest/bin/jest.js --config jest.release.config.ts scripts/release/release-policy.spec.ts` | Exit 0 — 12 tests passed | Skip helper, scanner, and P2-10 policy tests pass |
| `node node_modules/ts-node/dist/bin.js ... scripts/release/dockerignore-policy.ts` | Exit 0 — dockerignore policy check passed | P2-10 dockerignore gate intact |
| `node node_modules/ts-node/dist/bin.js ... scripts/release/build-archive.ts` | Exit 0 — archive created | `git archive HEAD` packaging succeeds |
| `node node_modules/ts-node/dist/bin.js ... scripts/release/verify-archive.ts` | Exit 0 — 402 entries, required files yes, verification passed | Primary V-21 gate satisfied |
| `npm run lint` | Exit 0 | No lint violations |
| `git archive --format=tar HEAD \| tar -t` (filter `release-policy.spec.ts`) | `scripts/release/release-policy.spec.ts` present | AC-8 confirmed |
| Grep `AKIAIOSFODNN7EXAMPLE` / contiguous secret patterns in `release-policy.spec.ts` | No matches | Fixture hardening confirmed |

## Findings

### Matches approved plan

- `shouldScanEntryForSecrets()` exported from `release-policy.ts` (lines 141–145), uses `normalizeArchivePath()` and basename suffix match as specified.
- `verify-archive.ts` imports helper and `continue`s before `extractEntryBuffer` / `scanTextForSecrets` (lines 148–150).
- Spec fixtures rewritten via runtime string assembly; no contiguous secret literals in source.
- Unit coverage for skip paths (`release-policy.spec.ts`, `env.schema.spec.ts`) and scan paths (`main.ts`, `.env.example`).
- Regression test proves scanner not globally disabled for non-test paths.
- `.github/workflows/release-artifact.yml` runs `npm run release:check` on Ubuntu CI (canonical path).

### Skeptical review of prior reports

| Claim | Verifier assessment |
| ----- | ------------------- |
| P2-15 on `HEAD` at `7d617ed` | **Confirmed** via `git log` |
| 12 tests passed | **Confirmed** independently via direct jest invocation |
| Decomposed release chain exit 0 | **Confirmed** independently in this session |
| Archive-level negative control skipped | **Reasonable** — unit test on production path satisfies plan Option A |

## Documentation alignment

V-21 backlog criterion: `npm run release:check` passes while still catching real secret artifacts — satisfied via decomposed release chain + negative-control unit test. No documentation updates required for this verification item.

## Remaining risks

1. **Windows `npm run` / `npx`** — intermittent exit `-1073741819` on chained npm and first test attempt. Ubuntu CI is canonical; local developers should use `node node_modules/ts-node/dist/bin.js` decomposed steps or direct `node node_modules/jest/bin/jest.js` if npm wrapper crashes.
2. **Skip helper scope** — only `*.spec.ts`, `*.int-spec.ts`, `*.test.ts` basenames are skipped; misnamed production files would still be scanned (intended).
3. **gitleaks** — out of V-21 scope; fixture hardening should prevent false positives but gitleaks CI was not re-run in this session.

## Unverified areas

- Post-merge GitHub Actions `release-artifact.yml` runtime pass not observed in this session (local decomposed path is sufficient per plan).
- Chained `npm run release:check` exit 0 not confirmed on this Windows host; decomposed equivalent confirmed exit 0.
