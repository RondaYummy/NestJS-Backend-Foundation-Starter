---
issue_id: P2-23
status: approved
owner: human-approval-required
---

# P2-23 — Add CI workflow for build, lint, unit and module gates

## Source issue

- Backlog ID: `P2-23`
- Index: `docs/agent-backlog/INDEX.md` — Medium, Architectural risk
- Full issue: `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § "P2-23. Add CI workflow for build, lint, unit and module gates"
- Source review: `docs/agent-reports/full-review-2026-08-02.md` (Medium — CI runs only release archive + gitleaks)

## Current behavior

| Path / script | Role today |
| --- | --- |
| `.github/workflows/release-artifact.yml` | Only GitHub Actions workflow. Triggers: `push` to `main`, all `pull_request`, `workflow_dispatch`. Steps: `actions/checkout@v6` (fetch-depth 0), `actions/setup-node@v5` with `node-version-file: '.nvmrc'` + `cache: npm`, `npm ci`, `npm run release:check`, gitleaks. |
| `.nvmrc` | Pins `22.22.1` (used by release workflow). |
| `package.json` `engines.node` | `>=22.22.1 <25` |
| `npm run build` | `nest build api && nest build worker && nest build cron && nest build migrations` |
| `npm run lint` | `eslint . --max-warnings=0` |
| `npm run test:unit` | Jest unit gate (`jest.unit.config.ts`) |
| `npm run test:module` | Jest module/DI gate (`jest.module.config.ts --runInBand`) |
| `npm run test:all` | `test:unit` + `test:module` + `test:release` (documented merge gate in `AGENTS.md`; **not** run in any workflow) |
| `npm run test:int` | Integration suites; requires PostgreSQL/Redis; **not** in scope for green everyday CI (see P2-17) |

There is **no** `.github/workflows/ci.yml` (or any other workflow) that runs `build`, `lint`, `test:unit`, or `test:module`. Everyday PR/push quality therefore depends on local discipline and the release-archive/gitleaks job only.

Known related red gate (separate issue): review/reports show `npm run test:module` failing on `apps/cron/src/cron.module.spec.ts` (ioredis mock / BullMQ) — tracked as **P2-16**, not part of this plan’s code fix.

## Confirmed root cause

Quality gates already exist as npm scripts and are documented in `AGENTS.md` / README as the intended agent/merge checks, but they are **not wired into GitHub Actions**. The only workflow enforces release-archive policy and secret scanning, so compile, lint, unit, and module regressions can merge without CI failure.

**Issue validity:** still valid on the current branch (only `release-artifact.yml` under `.github/workflows/`; no CI quality workflow).

## Dependency/runtime flow

```text
PR / push to main
  └─► (today) release-artifact.yml
        └─► Node from .nvmrc → npm ci → release:check → gitleaks
  └─► (desired) ci.yml
        └─► Node from .nvmrc → npm ci
              → npm run build
              → npm run lint
              → npm run test:unit
              → npm run test:module
```

No Nest DI, contracts, HTTP, migrations, or application code paths change. Runtime entrypoints are unaffected; CI is a verification envelope around existing scripts.

## Goal

Add a dedicated GitHub Actions workflow that enforces the documented everyday quality gates (`build`, `lint`, `test:unit`, `test:module`) on PRs and pushes, using the same Node pin as `.nvmrc`, without weakening or removing the existing release/gitleaks workflow.

## Scope

1. Create `.github/workflows/ci.yml` that:
   - triggers on `pull_request` and `push` to `main` (and optionally `workflow_dispatch`, matching release workflow ergonomics);
   - uses `permissions: contents: read`;
   - runs on `ubuntu-latest`;
   - checks out the repo;
   - sets up Node via `actions/setup-node` with `node-version-file: '.nvmrc'` and `cache: npm` (same convention as `release-artifact.yml`);
   - runs `npm ci`;
   - runs, in order (fail-fast): `npm run build`, `npm run lint`, `npm run test:unit`, `npm run test:module`.
2. Leave `.github/workflows/release-artifact.yml` intact (AC-03) — do not merge gitleaks/release into the new job unless a human explicitly chooses a single-workflow design (see open questions).
3. Match action major versions already used by the repo (`actions/checkout@v6`, `actions/setup-node@v5`) unless those tags are unavailable at implement time (then pin the closest maintained major and note it in the implementation report).

## Out of scope

- Fixing the known `test:module` Cron/ioredis failure (**P2-16**).
- Fail-closed / service-backed `test:int` policy or CI job (**P2-17**).
- Dockerfile / Node major alignment (**P2-18**).
- Adding `test:release` / full `test:all` unless the human answers the open question below in favor of inclusion.
- Changing `package.json` scripts, Jest configs, Husky hooks, application/libs code, OpenAPI, Postman, or migrations.
- Documenting CI in README unless the human requests a short note (optional; not required by AC-01…AC-03).
- Marking P2-23 resolved in the backlog (verification + human acceptance only).
- Combining any other backlog issue.

## Files to create

| Path | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | New workflow: Node from `.nvmrc`, `npm ci`, then `build` → `lint` → `test:unit` → `test:module` on PR/push |

## Files to modify

| Path | Symbol / responsibility |
| --- | --- |
| None required for AC compliance | Production/runtime code and `release-artifact.yml` stay unchanged |

Optional (only if human answers open question 3 “yes”):

| Path | Symbol / responsibility |
| --- | --- |
| `README.md` | Short note under verification / getting-started that GitHub Actions runs build + lint + unit + module on PRs |

## Files to delete

- None.

## Contract and DI changes

- None. No tokens, providers, ports, OpenAPI, or Postman changes.

## Implementation steps

1. Confirm still no conflicting `ci.yml` and that `release-artifact.yml` remains the release/gitleaks gate.
2. Add `.github/workflows/ci.yml` with:
   - `name:` e.g. `CI` / `Quality gates` (implementer choice; keep concise);
   - `on.push.branches: [main]`, `on.pull_request:` (all PRs, same as release workflow), optional `workflow_dispatch`;
   - `permissions.contents: read`;
   - single job (e.g. `quality`) on `ubuntu-latest` unless human requests matrix parallelism;
   - steps: Checkout → Setup Node (`node-version-file: '.nvmrc'`, `cache: npm`) → `npm ci` → `npm run build` → `npm run lint` → `npm run test:unit` → `npm run test:module`.
3. Do **not** edit `release-artifact.yml`.
4. Locally verify the four npm scripts still match plan expectations (and note if `test:module` is red due to P2-16 — report as known blocker for green CI, do not “fix” it under this issue).
5. After merge/push opportunity, confirm the new workflow appears in Actions (or validate YAML structure statically if push is not available in the implementation session).

Recommended workflow skeleton (illustrative; implementer may adjust names/comments only):

```yaml
name: CI

on:
  push:
    branches:
      - main
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version-file: '.nvmrc'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm run test:unit

      - name: Module tests
        run: npm run test:module
```

Note: release workflow uses `fetch-depth: 0` for archive/history needs; the quality job does **not** need full history unless a future step requires it — default shallow checkout is fine.

## Migration and rollout concerns

- **No DB/migration/runtime deploy impact.**
- **CI redness risk:** If P2-16 is still open when this workflow lands, `test:module` will fail the new job on every PR/push until P2-16 is fixed. Prefer landing **P2-16 before or immediately with** human-accepted sequencing; do not silently weaken the module gate.
- Two workflows will both run `npm ci` on the same events — acceptable cost; keep jobs separate for clear failure attribution (quality vs release/gitleaks).
- Branch protection (requiring the new check) is a GitHub repo setting outside this codebase; call out in open questions if humans want it enforced.

## Targeted verification

```bash
# Validate workflow file exists and pins Node via .nvmrc (static)
# PowerShell:
Select-String -Path .github/workflows/ci.yml -Pattern "node-version-file|npm run build|npm run lint|test:unit|test:module"
Select-String -Path .github/workflows/release-artifact.yml -Pattern "release:check|gitleaks"

# Rehearse the same gates locally (same scripts CI will call)
npm ci
npm run build
npm run lint
npm run test:unit
npm run test:module
```

Conclusions to record: each command exit code; if `test:module` fails, attribute to P2-16 vs a workflow mistake.

## Full verification

```bash
npm run build
npm run lint
npm run test:unit
npm run test:module
```

Optional (not required by AC): `npm run test:release` or `npm run test:all` for parity with the documented merge gate.

Post-merge / Actions UI (when available): confirm the new `CI` workflow ran on a PR or push and that `Release artifact check` still ran independently.

Do **not** run `test:int`, migrations against unknown DBs, or destructive Docker volume commands.

## Acceptance criteria

- **AC-01:** PR/push CI runs `npm run build`, `npm run lint`, `npm run test:unit`, and `npm run test:module` (new or extended workflow).
- **AC-02:** Workflow Node setup uses `.nvmrc` (`node-version-file: '.nvmrc'`), matching the release workflow pin (`22.22.1` today).
- **AC-03:** `.github/workflows/release-artifact.yml` remains intact (still runs `release:check` + gitleaks) unless the human explicitly approved a merged workflow design in open questions.

## Risks

| Risk | Mitigation |
| --- | --- |
| CI permanently red while P2-16 open | Sequence P2-16 first, or accept temporary red and fix immediately after; do not drop `test:module` from CI |
| Duplicate `npm ci` cost on PRs | Keep separate jobs; acceptable for clarity |
| Action version drift (`checkout`/`setup-node`) | Match `release-artifact.yml` majors |
| Humans expect `test:all` / `test:release` in CI | Decide via open question; default plan follows backlog AC only |
| Branch protection not updated | Document; optional human repo-settings follow-up |

## Rollback strategy

- Delete `.github/workflows/ci.yml` (or revert the commit that added it).
- `release-artifact.yml` unchanged → release/gitleaks gate continues without rollback work.

## Open questions requiring human decision

1. **Sequencing with P2-16:** Should P2-23 merge only after P2-16 makes `test:module` green, or is temporary red CI on `main`/PRs acceptable?
2. **Include `test:release`?** Backlog AC lists build/lint/unit/module only. `AGENTS.md` merge gate is `test:all` (adds `test:release`). Default: **omit** `test:release` unless you say include it.
3. **README note?** Optional one-liner that PR CI runs these gates — default: **skip** (not in AC).
4. **Branch protection:** Should the new workflow job be a required status check in GitHub settings? (Out of repo files; human/admin action.)
5. **Single vs dual workflow:** Default: **new `ci.yml`**, leave release/gitleaks alone (matches AC-03). Confirm you do **not** want to fold quality steps into `release-artifact.yml`.
