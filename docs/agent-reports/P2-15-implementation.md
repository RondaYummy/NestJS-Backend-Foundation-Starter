# P2-15 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P2-15-release-check-secret-scan-false-positive.md` (`status: approved`)

## Changed files

| Path                                     | Change                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `scripts/release/release-policy.ts`      | Added `shouldScanEntryForSecrets()` — returns `false` for `.spec.ts`, `.int-spec.ts`, `.test.ts` archive paths |
| `scripts/release/verify-archive.ts`      | Skip secret content scan when `shouldScanEntryForSecrets()` returns `false`                                    |
| `scripts/release/release-policy.spec.ts` | Rewrote scanner fixtures via runtime string assembly; added skip-helper and non-test path regression tests     |

## Completed steps

1. **Add skip helper in `release-policy.ts`** — `shouldScanEntryForSecrets()` normalizes path and matches basename against `/\.(spec|int-spec|test)\.ts$/i`.
2. **Wire skip into `verify-archive.ts`** — After extension filter, before `extractEntryBuffer` / `scanTextForSecrets`, entries with test-only suffixes are skipped.
3. **Harden `release-policy.spec.ts` fixtures** — Replaced contiguous AWS key / private-key literals with `['AKIA', 'IOSFODNN7EXAMPLE', ...].join('')` assembly.
4. **Add unit tests for skip policy** — Covers `release-policy.spec.ts`, `env.schema.spec.ts` (skip) and `main.ts`, `.env.example` (scan).
5. **Regression assertion for non-test paths** — `still flags secrets on non-test archive paths` proves scanner is not globally disabled.
6. **P2-10 gates unchanged** — No changes to `FORBIDDEN_*`, `REQUIRED_ARCHIVE_ENTRIES`, `.gitattributes`, or dockerignore policy.

## Deviations

None from approved plan scope.

**Manual negative check note:** The plan's optional in-archive negative check (add contiguous `AKIA…` literal to a non-test file, run `release:archive` + `release:verify`) cannot detect uncommitted working-tree edits because `build-archive.ts` uses `git archive HEAD`. Negative detection is covered by the unit test `still flags secrets on non-test archive paths`, which passes assembled secret patterns through `scanTextForSecrets()` with a production `.ts` path.

## Commands executed

| Command                                                       | Result                   | Conclusion                                                              |
| ------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `npm run test:unit -- scripts/release/release-policy.spec.ts` | Exit 0 — 12 tests passed | Skip helper, scanner fixtures, and P2-10 policy tests pass              |
| `npm run release:check`                                       | Exit 0                   | Full chain (dockerignore → archive → verify) passes; no secret findings |
| `npm run lint`                                                | Exit 0                   | No lint violations                                                      |

## Command results

### Unit tests

```text
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

### Release check

```text
.dockerignore release policy check passed.
Created release archive: .../dist/release/nestjs-backend-foundation-starter-1.0.0.zip
Archive: .../nestjs-backend-foundation-starter-1.0.0.zip
Entries: 395
Required files present: yes
Release archive verification passed.
```

## Acceptance criteria self-check

| Criterion                                                                      | Status | Evidence                                                      |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------- |
| `npm run release:check` passes on clean tree                                   | Met    | Exit 0                                                        |
| Scanner still flags real secret patterns in non-test archive members           | Met    | Unit test `still flags secrets on non-test archive paths`     |
| P2-10 forbidden-path rules still reject `.env`, `.git/`, `node_modules/`, etc. | Met    | Existing `isForbiddenArchivePath` tests unchanged and passing |
| P2-10 required files still enforced                                            | Met    | `release:verify` reports "Required files present: yes"        |
| Policy test and verify skip policy aligned — no contradictory failure          | Met    | `release:check` exit 0; spec fixtures use split literals      |
| Test sources may remain in release ZIP                                         | Met    | Archive has 395 entries; skip applies only to content scan    |

## Remaining risks

| Risk                                                                       | Mitigation in place                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Real secret committed in `*.spec.ts` would not be caught by archive verify | gitleaks still scans repo in CI; production `.ts` paths still scanned |
| Non-standard test suffixes (e.g. `.e2e.ts`) could false-positive           | Documented in plan; extend suffix list only when needed               |
| gitleaks may still flag split fixtures on PRs                              | Out of P2-15 scope per approved plan                                  |

## Unverified areas

- **gitleaks CI** — Not run; `.gitleaks.toml` unchanged.
- **In-archive negative check with committed secret** — Not performed (would require a disposable commit); covered by unit test instead.
- **`npm run build`** — Not required per plan (tooling-only change).
