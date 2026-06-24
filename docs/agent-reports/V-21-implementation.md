# V-21 — Implementation report

## Verdict

**implemented** (verification completed; no production code changes in this session)

## Approved plan

`docs/agent-plans/V-21-release-check-secret-scan.md` — `status: approved`

V-21 is a **verification** backlog item. The underlying fix was delivered by **P2-15** (`docs/agent-plans/P2-15-release-check-secret-scan-false-positive.md`, `status: approved`, commit `7d617ed`). This session performed independent verification per the V-21 plan and produced `docs/agent-reports/V-21-verification.md`.

## Changed files

None in this session (read-only verification).

**P2-15 artifacts verified (pre-existing on branch):**

| Path | Role |
| ---- | ---- |
| `scripts/release/release-policy.ts` | `shouldScanEntryForSecrets()` skip helper; `scanTextForSecrets()` unchanged |
| `scripts/release/verify-archive.ts` | Content-scan loop calls skip helper before `scanTextForSecrets()` |
| `scripts/release/release-policy.spec.ts` | Runtime-assembled fixtures; skip-helper and non-test path regression tests |
| `.github/workflows/release-artifact.yml` | CI runs `npm run release:check` on Ubuntu |

## Completed steps

1. Confirmed P2-15 plan approved and implementation committed on `HEAD`.
2. Ran scope and diff review — only P2-15 release-tooling files; P2-10 symbols untouched.
3. Static policy trace — skip helper wired; no contiguous secret literals in spec source.
4. Ran `npm run test:release -- scripts/release/release-policy.spec.ts` (12 tests passed).
5. Ran primary release gate — decomposed ts-node chain (dockerignore → archive → verify) exit 0; 402 entries, required files present.
6. Negative control (Option A) — unit test `still flags secrets on non-test archive paths` confirms scanner not weakened.
7. P2-10 regression — forbidden/required gates unchanged; verify reports required files present.
8. Ran `npm run lint` — exit 0.
9. Wrote `docs/agent-reports/V-21-verification.md` with verdict **approved**.

## Deviations

- Plan lists `npm run test:unit -- scripts/release/release-policy.spec.ts`; executed via `npm run test:release` because `jest.unit.config.ts` excludes `scripts/release/` (V-14 suite split).
- Chained `npm run release:check` failed on Windows (`exit -1073741819` / archive `Access is denied`); used decomposed `npx ts-node` invocations per plan Step 4 fallback (same pattern as P2-10 / P2-15 verification).

## Commands executed

```bash
npm run test:release -- scripts/release/release-policy.spec.ts
npm run release:check
npx ts-node --project scripts/release/tsconfig.json --transpile-only scripts/release/dockerignore-policy.ts
npx ts-node --project scripts/release/tsconfig.json --transpile-only scripts/release/build-archive.ts
npx ts-node --project scripts/release/tsconfig.json --transpile-only scripts/release/verify-archive.ts
npm run lint
```

## Command results

| Command | Result | Conclusion |
| ------- | ------ | ---------- |
| `npm run test:release -- scripts/release/release-policy.spec.ts` | Exit 0; 12 tests passed | AC-3, AC-4, AC-5 unit evidence |
| `npm run release:check` | Exit `-1073741819` / exit 1 (`Access is denied`) | Windows npm/environment issue; not a policy defect |
| `npx ts-node ... dockerignore-policy.ts` | Exit 0 | Dockerignore gate passes |
| `npx ts-node ... build-archive.ts` | Exit 0 | Archive created from `HEAD` |
| `npx ts-node ... verify-archive.ts` | Exit 0; 402 entries; required files yes | Primary V-21 gate satisfied |
| `npm run lint` | Exit 0 | AC-9 |

## Acceptance criteria self-check

All AC-1 through AC-9 from the V-21 plan pass. See `docs/agent-reports/V-21-verification.md` for per-criterion evidence.

## Remaining risks

- Windows developers may need the decomposed ts-node fallback when `npm run release:check` crashes or hits archive file locks.
- gitleaks CI pass not re-observed in this session (out of V-21 scope).

## Unverified areas

- GitHub Actions `release-artifact.yml` runtime on Ubuntu not observed post-verification session.
- Explicit `git archive` listing of `*.spec.ts` entries blocked by Windows shell crash; inferred from unchanged packaging and successful verify.
