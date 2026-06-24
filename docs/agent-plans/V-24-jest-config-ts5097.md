---
issue_id: V-24
status: approved
owner: human-approval-required
---

# V-24 — Jest config parses: root typecheck and test scripts do not fail on TS5097

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-24**:

> Jest config parses: root typecheck and test scripts do not fail on TS5097

**Linked defect:** **P2-18** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — § P2-18).

**Investigation (2026-06-24, current branch):** verification scenario is **not stale**. Root TypeScript check still fails with four `TS5097` errors. Jest npm scripts currently reach test execution on this machine, but root typecheck remains blocked and the import strategy documented in P2-18 is **incompatible** with Jest’s Node16 config loader unless additional changes are made.

**Planner spike evidence:**

| Change tested | Root `tsc -p tsconfig.json` | Jest config load |
| ------------- | ----------------------------- | ---------------- |
| Current `./jest.config.base.ts` | **TS5097** (4 files) | Pass (`test:unit`, `test:module`, `test:release`) |
| Extensionless `./jest.config.base` (P2-18 literal suggestion) | Would pass import rule | **Fail** — `ERR_MODULE_NOT_FOUND` |
| `.js` suffix import | N/A | **Fail** — `ERR_MODULE_NOT_FOUND` |
| `./jest.config.base.cjs` import | Pass (no TS5097 on import); needs `.d.ts` for strict typing | Pass |

## Current behavior

1. **Four Jest entry configs** share one base module via a `.ts`-suffixed relative import:

   | File | Line 3 import |
   | ---- | ------------- |
   | `jest.unit.config.ts` | `import baseConfig from './jest.config.base.ts';` |
   | `jest.module.config.ts` | same |
   | `jest.integration.config.ts` | same |
   | `jest.release.config.ts` | same |

   Shared base: `jest.config.base.ts` (preset, `moduleNameMapper`, ts-jest transform → `tsconfig.jest.json`).

2. **Root `tsconfig.json`** has no `include`/`exclude`; default project discovery pulls in all five Jest tooling files alongside app/lib sources. Compiler options use `"module": "node16"` / `"moduleResolution": "node16"` without `allowImportingTsExtensions`.

3. **Root typecheck fails before any application code is evaluated:**

   ```bash
   npx tsc --noEmit -p tsconfig.json --pretty false
   ```

   ```text
   jest.integration.config.ts(3,24): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
   jest.module.config.ts(3,24): error TS5097: ...
   jest.release.config.ts(3,24): error TS5097: ...
   jest.unit.config.ts(3,24): error TS5097: ...
   ```

4. **Jest scripts currently parse and run** on planner environment (Node 22+, Jest 30 / ts-jest):

   | Command | Planner result |
   | ------- | -------------- |
   | `npm run test:unit -- --silent` | Exit 0 — 18 suites |
   | `npm run test:module -- --silent` | Exit 0 — 9 suites |
   | `npm run test:release -- --silent` | Exit 0 — 1 suite |

   Each run emits `MODULE_TYPELESS_PACKAGE_JSON` warning for `jest.config.base.ts` (package.json has no `"type": "module"`). This is noisy but not a hard failure today.

5. **P3-04 implementation deviation** (`docs/agent-reports/P3-04-implementation.md`) documents that the `.ts` suffix was kept **on purpose** for Node16 ESM resolution when Jest loads TypeScript config files. That matches planner spike: extensionless imports break Jest config parsing.

6. **Entrypoint typechecks** (`apps/*/tsconfig.app.json`) exclude `**/*.spec.ts` and do not include root Jest configs — they pass independently. V-24 is about root `tsconfig.json` + Jest bootstrap, not Nest build graphs.

7. **No dedicated `P2-18` implementation plan** exists yet; this V-24 plan carries the corrected fix strategy for human approval before implementation.

## Confirmed root cause

Two constraints conflict under Node16 module resolution:

1. **TypeScript root check (`TS5097`)** — `.ts`-suffixed relative imports are illegal unless `allowImportingTsExtensions` is enabled (typically with `noEmit`).
2. **Jest TypeScript config loader** — when Jest loads `jest.*.config.ts` as ESM, extensionless relative imports to `./jest.config.base` fail with `ERR_MODULE_NOT_FOUND`; the `.ts` suffix is currently required for runtime config resolution.

P2-18’s naive “remove `.ts` extension only” fix resolves (1) but breaks (2). The defect is real; the backlog’s single-step import change is **insufficient** for this repository’s Node16 + Jest setup.

## Dependency/runtime flow

### Current (V-24 fails root typecheck today)

```text
npx tsc --noEmit -p tsconfig.json
  -> discovers jest.config.base.ts + jest.{unit,module,integration,release}.config.ts
  -> TS5097 on .ts-suffixed imports ❌

npm run test:{unit,module,release,int}
  -> node node_modules/jest/bin/jest.js --config jest.*.config.ts
       -> dynamic import ./jest.config.base.ts  [works today ✓]
       -> ts-jest transform for specs via tsconfig.jest.json
```

### Expected after P2-18 (V-24 pass condition)

```text
npx tsc --noEmit -p tsconfig.json --pretty false
  -> exit 0; no TS5097 on Jest tooling paths ✓

npm run test:unit / test:module / test:release / test:int
  -> Jest parses all four configs without TS5097 / ERR_MODULE_NOT_FOUND ✓
  -> suites execute (pass/fail determined by tests, not config bootstrap) ✓
```

## Goal

Restore a reliable verification gate so agents and CI can run root TypeScript check and all Jest npm scripts without failing on Jest config parsing/type errors (`TS5097`), while preserving the P3-04 test-suite split (`test:unit`, `test:module`, `test:release`, `test:int`).

## Scope

| Activity | Owner | Notes |
| -------- | ----- | ----- |
| Fix TS5097 / Jest bootstrap conflict | **P2-18 implementer** | Per approved approach below |
| Independent verification | **V-24 verifier** | Inspect diff, run commands, write `docs/agent-reports/V-24-verification.md` |

## Out of scope

- P3-04 runtime stability (timeouts, open handles, TS151002) — remains separate via V-14.
- Changing production NestJS code, contracts, DI, or entrypoint `tsconfig.app.json` graphs.
- Adding `"type": "module"` to root `package.json` (wide blast radius).
- Enabling `allowImportingTsExtensions` globally in root `tsconfig.json` without a scoped jest-tooling config.
- Marking P2-18 or V-24 resolved in backlog without implementation + verification evidence.

## Files to create

| File | Symbol / responsibility |
| ---- | ----------------------- |
| `docs/agent-reports/V-24-verification.md` | Independent verification report (verifier output) |
| `tsconfig.jest-config.json` *(Option B only)* | Optional dedicated typecheck for Jest tooling with `allowImportingTsExtensions: true` |
| `jest.config.base.d.ts` *(Option C only)* | Ambient module declaration for `jest.config.base.cjs` |

## Files to modify

### P2-18 implementer (choose one approved option)

| File | Responsibility |
| ---- | -------------- |
| `tsconfig.json` | **Option A (recommended):** add `exclude` for Jest tooling files so root typecheck skips them; keep `.ts` imports unchanged |
| `jest.unit.config.ts` | **Option C:** change import target to `./jest.config.base.cjs` |
| `jest.module.config.ts` | same as unit (Options B/C) |
| `jest.integration.config.ts` | same |
| `jest.release.config.ts` | same |
| `jest.config.base.ts` → `jest.config.base.cjs` | **Option C:** convert shared base to CJS export |
| `package.json` | **Optional:** add `typecheck:jest-config` script if Option B added |
| `AGENTS.md` / `README.md` | Document root typecheck vs Jest-config typecheck boundaries *(only if scripts change)* |

## Files to delete

| File | When |
| ---- | ---- |
| `jest.config.base.ts` | Option C only — replaced by `.cjs` + optional `.d.ts` |

## Contract and DI changes

None. Tooling-only change; no NestJS modules, ports, tokens, or runtime API surface.

## Implementation steps

V-24 is a verification issue. **P2-18 must be implemented first.** Steps below define the fix (for implementer) and verification (for verifier).

### Prerequisite gate (verifier)

1. Confirm this plan frontmatter is `status: approved`.
2. Confirm P2-18 implementation exists (inspect `git diff`; read implementation report if present — do not trust without code inspection).
3. If P2-18 is not implemented, stop and return verdict **`changes-required`**.

---

### P2-18 fix — Option A (recommended, minimal)

**Rationale:** Jest requires `.ts`-suffixed imports today; excluding tooling files from root `tsconfig.json` removes `TS5097` without breaking Jest. Aligns with how entrypoint apps already use dedicated tsconfigs.

1. Add explicit `exclude` to `tsconfig.json`:

   ```json
   "exclude": [
     "node_modules",
     "dist",
     "jest.config.base.ts",
     "jest.*.config.ts"
   ]
   ```

2. **Do not** change `./jest.config.base.ts` imports in the four Jest config files.

3. *(Optional hardening)* Add `tsconfig.jest-config.json`:

   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "allowImportingTsExtensions": true,
       "noEmit": true
     },
     "include": [
       "jest.config.base.ts",
       "jest.*.config.ts"
     ]
   }
   ```

   Optional npm script: `"typecheck:jest-config": "tsc --noEmit -p tsconfig.jest-config.json --pretty false"`.

4. Re-run targeted verification commands (below).

---

### P2-18 fix — Option C (alternative if Jest configs must stay in root typecheck)

1. Move shared preset from `jest.config.base.ts` to `jest.config.base.cjs` (`module.exports = { preset, moduleNameMapper, transform, … }`).
2. Add `jest.config.base.d.ts`:

   ```typescript
   import type { Config } from 'jest';
   declare const config: Config;
   export default config;
   ```

3. Update all four `jest.*.config.ts` files:

   ```typescript
   import baseConfig from './jest.config.base.cjs';
   ```

4. Delete `jest.config.base.ts`.
5. Re-run targeted verification commands.

**Do not implement Option B (extensionless `.ts` import)** — planner-confirmed Jest bootstrap failure.

---

### V-24 verification steps (independent verifier)

#### Step 1 — Scope and diff review

1. Run `git status` and `git diff`.
2. Confirm changes are limited to Jest tooling / tsconfig files (no unrelated production edits).
3. Confirm `.ts`-suffix imports remain if Option A; confirm `.cjs` base if Option C.
4. Confirm root `tsconfig.json` was **not** given global `allowImportingTsExtensions` unless scoped to `tsconfig.jest-config.json` only.

#### Step 2 — Root typecheck (mandatory)

```bash
npx tsc --noEmit -p tsconfig.json --pretty false
```

**Expected:** exit 0; **zero** `TS5097` lines referencing `jest.*.config.ts` or `jest.config.base.ts`.

#### Step 3 — Jest config bootstrap (mandatory)

Run each command; all must parse config and start suites (exit 0 on current green tree):

```bash
npm run test:unit -- --silent --listTests
npm run test:module -- --silent --listTests
npm run test:release -- --silent --listTests
npm run test:int -- --listTests
```

**Expected:** no `Failed to parse the TypeScript config file`, no `TS5097`, no `ERR_MODULE_NOT_FOUND` for `jest.config.base`.

**Windows note:** if `npm run` crashes with exit `-1073741819`, retry via direct node invocation (same pattern as V-14 / P2-08):

```bash
node node_modules/jest/bin/jest.js --config jest.unit.config.ts --listTests
node node_modules/jest/bin/jest.js --config jest.module.config.ts --listTests
node node_modules/jest/bin/jest.js --config jest.release.config.ts --listTests
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --listTests
```

Record which path was used.

#### Step 4 — Full Jest gate (mandatory)

```bash
npm run test:all
```

**Expected:** exit 0 (unit + module + release chain). Failures here indicate test regressions, not config parse errors — distinguish in report.

#### Step 5 — Nest build regression (mandatory)

```bash
npm run build
```

**Expected:** exit 0. Jest tsconfig changes must not break Nest entrypoint builds.

#### Step 6 — Lint (mandatory)

```bash
npm run lint
```

**Expected:** exit 0.

#### Step 7 — Optional jest-config dedicated typecheck

If implementer added `tsconfig.jest-config.json`:

```bash
npm run typecheck:jest-config
```

**Expected:** exit 0 with `.ts`-suffixed imports allowed in scoped config only.

## Migration and rollout concerns

- **No database, env, or deployment migration.**
- **CI impact:** any workflow or agent script running `tsc -p tsconfig.json` will start passing once Option A/C lands.
- **Consumer impact:** none — Jest configs are maintainer/agent tooling, not published library API.
- **Option A trade-off:** root `tsconfig.json` no longer typechecks Jest config files unless optional `tsconfig.jest-config.json` is added and run explicitly.

## Targeted verification

| Command | Expected |
| ------- | -------- |
| `npx tsc --noEmit -p tsconfig.json --pretty false` | Exit 0; no TS5097 on jest configs |
| `npm run test:module -- --silent --listTests` | Exit 0; config parses |
| `npm run test:unit -- --silent` | Exit 0; suites run |
| `npm run test:release -- --silent` | Exit 0; suites run |

## Full verification

| Command | Expected |
| ------- | -------- |
| `npm run test:all` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run build` | Exit 0 |
| `npm run test:int -- --listTests` | Exit 0 (infra not required for listTests) |

## Acceptance criteria

- [ ] **AC-1:** `npx tsc --noEmit -p tsconfig.json --pretty false` exits 0 with no `TS5097` on Jest config paths.
- [ ] **AC-2:** `npm run test:unit`, `npm run test:module`, `npm run test:release`, and `npm run test:int` do not fail on Jest TypeScript config parsing.
- [ ] **AC-3:** `npm run test:all` exits 0 on a clean tree (config bootstrap + existing suites).
- [ ] **AC-4:** P3-04 test split preserved — no collapse of unit/module/release configs back into one bucket.
- [ ] **AC-5:** `npm run build` and `npm run lint` remain passing.
- [ ] **AC-6:** Independent verification report written to `docs/agent-reports/V-24-verification.md` with command/scenario/exit-code evidence per backlog §7 template.
- [ ] **AC-7:** P3-04 remains a separate concern (V-14); V-24 does not claim resolution of unit-suite timeout/open-handle issues.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Implementer applies P2-18 extensionless import literally | This plan explicitly rejects it; verifier must fail AC-2 if `ERR_MODULE_NOT_FOUND` appears |
| Option A hides Jest config type errors from root tsc | Optional `tsconfig.jest-config.json` + `typecheck:jest-config` script |
| `MODULE_TYPELESS_PACKAGE_JSON` warning persists | Out of P2-18 scope; document under unverified areas unless human approves `"type": "module"` separately |
| Windows npm Jest wrapper crash | Direct `node node_modules/jest/bin/jest.js` fallback documented |
| Backlog INDEX out of sync | `docs/agent-backlog/INDEX.md` was deleted in working tree; V-24 row confirmed in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` §7 |

## Rollback strategy

1. Revert tsconfig exclude / jest base file changes in a single commit.
2. Restore `jest.config.base.ts` and `.ts`-suffixed imports if Option C was used.
3. Re-run `npm run test:all` to confirm Jest bootstrap restored.

## Open questions requiring human decision

1. **Fix option:** Approve **Option A (exclude from root tsconfig, keep `.ts` imports)** vs **Option C (`.cjs` base + `.d.ts`)** before implementation. Planner recommends Option A unless root typecheck must cover Jest configs.
2. **Dedicated jest-config typecheck:** Should implementer add optional `tsconfig.jest-config.json` + npm script, or is root exclude sufficient?
3. **`MODULE_TYPELESS_PACKAGE_JSON` warning:** Address in this scope (e.g. `"type": "module"`, or convert base to `.cjs`) or defer?
4. **Backlog text update:** Should P2-18 acceptance criteria in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` be amended to reflect Option A/C instead of extensionless import only?
