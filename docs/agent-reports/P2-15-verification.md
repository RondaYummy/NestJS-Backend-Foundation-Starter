# P2-15 — Independent verification

## Verdict

**approved**

## Scope checked

**Plan status:** `docs/agent-plans/P2-15-release-check-secret-scan-false-positive.md` — `status: approved` ✓

**Git state (verifier run):** Four staged files only; no unrelated production or infrastructure changes.

| Path                                         | Role                                   | In plan?          |
| -------------------------------------------- | -------------------------------------- | ----------------- |
| `scripts/release/release-policy.ts`          | Added `shouldScanEntryForSecrets()`    | Yes               |
| `scripts/release/verify-archive.ts`          | Skip secret scan for test-only paths   | Yes               |
| `scripts/release/release-policy.spec.ts`     | Fixture hardening + skip/scanner tests | Yes               |
| `docs/agent-reports/P2-15-implementation.md` | Implementation report                  | Expected artifact |

**Out-of-scope files:** No changes to `.gitattributes`, `FORBIDDEN_*`, `REQUIRED_ARCHIVE_ENTRIES`, dockerignore policy, NestJS apps/libs, or `.gitleaks.toml`.

**Note:** Changes are staged but not committed to `HEAD`. `build-archive.ts` uses `git archive HEAD`, so the current ZIP still contains the pre-fix literal fixtures in `release-policy.spec.ts` until commit. Verification confirms the skip helper alone resolves the defect; fixture hardening adds defense in depth once committed.

## Root-cause assessment

**Original defect (confirmed):** `verify-archive.ts` content-scans all archived `.ts` files via `scanTextForSecrets()`. `release-policy.spec.ts` embeds contiguous AWS access-key and private-key-block literals to test the scanner. Verify and the unit test contradicted each other — verify flagged the test file as a secret.

**Fix addresses root cause (not a symptom-only workaround):**

1. **Layer A — skip policy:** `shouldScanEntryForSecrets()` returns `false` for basenames matching `/\.(spec|int-spec|test)\.ts$/i`, wired in `verifyArchive()` after the extension filter and before content extraction/scanning.
2. **Layer B — fixture hardening:** Spec file literals split and joined at runtime so source no longer contains contiguous high-confidence patterns (grep confirms no `AKIAIOSFODNN7EXAMPLE` or `BEGIN PRIVATE KEY` literals in working-tree spec file).

Both layers match the approved two-layer plan. P2-10 forbidden-path and required-file gates are untouched.

## Acceptance criteria matrix

| Criterion (approved plan)                                                      | Status     | Evidence                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run release:check` passes on a clean tree                                 | **passed** | Full chain exit 0 (dockerignore → archive → verify); 398 entries, required files yes, verification passed. Confirmed independently in verifier shell and via decomposed `build-archive.ts` + `verify-archive.ts`. |
| Scanner still flags real secret patterns in non-test archive members           | **passed** | Unit test `still flags secrets on non-test archive paths` passes assembled patterns through `scanTextForSecrets(..., 'apps/api/src/main.ts')` and asserts `aws-access-key` and `private-key-block`.               |
| P2-10 forbidden-path rules still reject `.env`, `.git/`, `node_modules/`, etc. | **passed** | No diff to `FORBIDDEN_*` constants or `isForbiddenArchivePath()`. Existing unit tests in `release-policy.spec.ts` unchanged and passing.                                                                          |
| P2-10 required files still enforced                                            | **passed** | `verify-archive.ts` output: `Required files present: yes`. `findMissingRequiredFiles` tests still pass.                                                                                                           |
| Policy test and verify skip policy aligned — no contradictory failure          | **passed** | Verify on `HEAD`-based archive (still containing old literal fixtures in spec file) passes because skip helper excludes `*.spec.ts`. Working-tree fixtures no longer contain contiguous patterns.                 |
| Test sources may remain in release ZIP (P2-10 preserved)                       | **passed** | Archive has 398 entries; skip applies only to content scan, not packaging. No `export-ignore` for `*.spec.ts`.                                                                                                    |

**Backlog issue criteria (source P2-15):** All four map to the matrix above — passed.

## Dependency and DI verification

Not applicable. Release tooling only; no NestJS tokens, providers, modules, or runtime entrypoint changes.

## Commands executed

| Command                                                       | Result                                                                     | Conclusion                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Exit 0 — 12 tests passed                                                   | Skip helper, scanner, and P2-10 policy tests pass independently |
| `npx ts-node ... scripts/release/build-archive.ts`            | Exit 0                                                                     | Archive created from `HEAD`                                     |
| `npx ts-node ... scripts/release/verify-archive.ts`           | Exit 0 — 398 entries, required files yes, verification passed              | Primary V-21 gate satisfied on current archive                  |
| `npm run lint`                                                | Exit 0                                                                     | No lint violations                                              |
| `npm run release:check`                                       | Exit 0 — dockerignore passed, archive created, verify passed (398 entries) | Full V-21 primary gate satisfied                                |
| `npm run release:check-dockerignore`                          | Exit 0 (via `release:check` chain)                                         | Unchanged by P2-15; passes as part of full chain                |

## Findings

### Matches approved plan

- `shouldScanEntryForSecrets()` exported from `release-policy.ts`, uses `normalizeArchivePath()` and basename suffix match as specified.
- `verify-archive.ts` imports helper and `continue`s before `extractEntryBuffer` / `scanTextForSecrets`.
- Spec fixtures rewritten via runtime string assembly; no contiguous secret literals in working tree.
- Unit coverage for skip paths (`release-policy.spec.ts`, `env.schema.spec.ts`) and scan paths (`main.ts`, `.env.example`).
- Regression test proves scanner not globally disabled for non-test paths.
- No deviations from plan scope documented or observed.

### Skeptical review of implementation report

| Claim                                                   | Verifier assessment                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 12 tests passed                                         | **Confirmed** independently                                                                                           |
| `release:check` exit 0                                  | **Confirmed** independently — full chain exit 0                                                                       |
| Manual negative check skipped due to `git archive HEAD` | **Reasonable** — unit test on production path is adequate substitute per plan                                         |
| P2-10 gates unchanged                                   | **Confirmed** — diff limited to skip helper and tests                                                                 |
| 395 archive entries                                     | **Minor discrepancy** — verifier saw 398 entries (likely `HEAD` vs staged doc/report delta); immaterial to acceptance |

### Minor observations (non-blocking)

- Unit tests do not explicitly assert `.test.ts` or `.int-spec.ts` suffixes; regex implementation includes them as planned.
- Until commit, archive content for `release-policy.spec.ts` still has literals at `HEAD`; skip helper is the active fix path for `release:verify`.

## Documentation alignment

Implementation report accurately describes changed files and approach. Plan open question #1 (both layers) matches implementation. No README changes required per plan.

## Remaining risks

| Risk                                                       | Assessment                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Real secret in `*.spec.ts` missed by archive verify        | Accepted per plan; gitleaks still scans repo; production `.ts` still scanned |
| Non-standard test suffixes (e.g. `.e2e.ts`) false-positive | Documented in plan; not observed                                             |
| gitleaks CI may flag split fixtures                        | Out of P2-15 scope; not verified                                             |
| Skip scope hides secrets in test files only                | Low likelihood; intentional trade-off per approved plan                      |

## Unverified areas

- **gitleaks CI** — not run.
- **End-to-end after commit** — staged-only state; recommend re-run `release:check` post-commit to confirm fixture hardening ships in archive (optional; skip already sufficient).
- **`npm run build`** — correctly omitted per plan (tooling-only).
