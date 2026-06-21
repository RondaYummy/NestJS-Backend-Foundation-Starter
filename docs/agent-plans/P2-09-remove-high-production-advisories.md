---
issue_id: P2-09
status: approved
owner: human-approval-required
---

# P2-09 — Усунути high advisories у production dependency graph

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` § P2-09 (Medium, Confirmed defect).

## Investigation notes (2026-06-21)

### 1. Current audit findings

Command executed: `npm audit --omit=dev --audit-level=high` (exit code 1).

| Metric                                     | Value      |
| ------------------------------------------ | ---------- |
| High                                       | **8**      |
| Critical                                   | **0**      |
| Moderate (below `--audit-level=high` gate) | 0 reported |
| Production deps scanned                    | 317        |

**Root vulnerable packages (2):** `multer@2.1.1`, `nodemailer@8.0.11`.

**npm audit duplicate count:** 8 high entries = 7 dependency-chain nodes re-reporting `multer` + 1 `nodemailer`:

| Package                    | Severity | Root cause                            |
| -------------------------- | -------- | ------------------------------------- |
| `multer`                   | high     | direct                                |
| `@nestjs/platform-express` | high     | depends on `multer@2.1.1`             |
| `@nestjs/core`             | high     | depends on `@nestjs/platform-express` |
| `@nestjs/bull-shared`      | high     | depends on `@nestjs/core`             |
| `@nestjs/bullmq`           | high     | depends on `@nestjs/bull-shared`      |
| `@nestjs/schedule`         | high     | depends on `@nestjs/core`             |
| `@nestjs/terminus`         | high     | depends on `@nestjs/core`             |
| `nodemailer`               | high     | direct                                |

**Advisories (GHSA; no CVE IDs in npm audit JSON):**

| Package      | GHSA                                                                     | Severity (advisory) | Vulnerable range         | Title                                                                                                          |
| ------------ | ------------------------------------------------------------------------ | ------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `multer`     | [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j) | high                | `>=1.0.0 <2.2.0`         | DoS via deeply nested multipart field names                                                                    |
| `multer`     | [GHSA-3p4h-7m6x-2hcm](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm) | moderate            | `>=2.0.0-alpha.1 <2.2.0` | DoS via incomplete cleanup of aborted uploads                                                                  |
| `nodemailer` | [GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f) | high                | `<=9.0.0`                | `raw` message option bypasses `disableFileAccess` / `disableUrlAccess` (file read + SSRF in delivered message) |

**Lockfile resolution (current branch):**

- `package-lock.json` → `node_modules/@nestjs/platform-express`: **11.1.27**, `"multer": "2.1.1"`
- `package-lock.json` → `node_modules/multer`: **2.1.1**
- `package-lock.json` → `node_modules/nodemailer`: **8.0.11**
- `package.json` direct: `"nodemailer": "^8.0.11"`, `"@nestjs/platform-express": "^11.1.26"`

**Issue still open:** counts match backlog evidence (`8 high, 0 critical`).

### 2. Patched versions available

| Package                    | Installed        | Patched   | How to obtain                                                                     |
| -------------------------- | ---------------- | --------- | --------------------------------------------------------------------------------- |
| `nodemailer`               | 8.0.11           | **9.0.1** | Direct `package.json` bump + `npm install`                                        |
| `multer`                   | 2.1.1            | **2.2.0** | Not direct; `@nestjs/platform-express@11.1.27` still declares `"multer": "2.1.1"` |
| `@nestjs/platform-express` | 11.1.27 (latest) | —         | Still pins vulnerable `multer@2.1.1`                                              |

`npm audit fix --force` is **unsafe**: proposes `@nestjs/core@7.5.5` (major downgrade) for multer and `nodemailer@9.0.1` for nodemailer. **Do not run without review** (per issue).

No `overrides` block exists in `package.json` today.

### 3. Exploitability in this codebase

#### multer (DoS)

**Usage search:** zero matches for `FileInterceptor`, `UploadedFile`, `FilesInterceptor`, `AnyFilesInterceptor`, `ParseFilePipe`, `FileFieldsInterceptor`, or `multer` in application/library TypeScript.

**HTTP surface:**

- `apps/api/src/main.ts` — `NestExpressApplication`, JSON `ValidationPipe`, CORS, cookies; no global multipart/file middleware.
- Controllers: `apps/api/src/controllers/auth.controller.ts` (JSON `@Post`), `libs/infrastructure/src/health/health.controller.ts` (`@Get` only).

**Conclusion:** Multer code paths are **not exercised** by current starter endpoints. Nest uses multer only via file-upload interceptors; default body parsing is Express JSON/urlencoded. Residual risk is **latent** (future upload features, or crafted `multipart/form-data` if a consumer adds interceptors without limits). Compensating control today: no upload routes.

#### nodemailer (raw option / file access / SSRF)

**Mail adapter:** `libs/infrastructure/src/mail/smtp-mail.adapter.ts`

- `nodemailer.createTransport({ host, port, auth })` — no `disableFileAccess` / `disableUrlAccess` (not required when `raw` is never passed).
- `transporter.sendMail({ from, to, subject, html, text })` only — **no `raw` option**.

**Contract:** `libs/contracts/src/mail/email-gateway.ts` — `IEmailGateway.send()` accepts `to`, `subject`, `html`, `text`, `from`, `template`, `data`; no raw MIME field.

**Call chain:**

- `apps/worker/src/processors/email.processor.ts` → `IEmailGateway.send()` with templated render or `RawEmailJob` (`html`/`text` strings from queue payload, not nodemailer `raw`).
- `libs/contracts/src/mail/email-job.ts` — `RawEmailJob` is structured html/text, not MIME `raw`.

**Conclusion:** Vulnerable `raw` code path is **not reachable** from current application code. Risk is **low** for shipped behavior; upgrade still required to clear audit gate and close future misuse.

### 4. Recommended fix strategy

| Package      | Strategy                                                      | Rationale                                                                                                           |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `nodemailer` | **Direct upgrade** to `^9.0.1` in `package.json` dependencies | Direct dependency; patch release fixes GHSA-p6gq-j5cr-w38f; `SmtpMailAdapter` uses stable `sendMail` fields only    |
| `multer`     | **`npm overrides`** → `"multer": "2.2.0"` in `package.json`   | Transitive only; upstream `@nestjs/platform-express` not yet bumped; patch semver within same major (2.1.1 → 2.2.0) |
| —            | **Reject** `npm audit fix --force`                            | Would downgrade NestJS ecosystem                                                                                    |

**Optional hardening (non-blocking for audit):**

- In `SmtpMailAdapter` constructor, pass `disableFileAccess: true` and `disableUrlAccess: true` to `createTransport` when nodemailer 9 API supports it — defense-in-depth, not a substitute for 9.0.1.
- When consumers add file-upload interceptors later, configure multer `limits.fieldNestingDepth` and `limits.fields` per [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j) (document in `EXAMPLES.md` only if hardening scope is approved).

**Fallback if override fails CI/runtime:** document time-bound exception with exploitability analysis (no upload routes; no `raw` mail) and track `@nestjs/platform-express` multer bump — **only if** override breaks Nest file-upload integration tests in downstream consumers.

### 5. Files to change

| Path                             | Change                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                   | Bump `nodemailer` to `^9.0.1`; add `"overrides": { "multer": "2.2.0" }`                                                                                |
| `package-lock.json`              | Regenerate via `npm install` (expected lockfile churn)                                                                                                 |
| `package.json` (devDependencies) | Re-evaluate `@types/nodemailer@^8.0.1` — latest DefinitelyTyped is 8.0.1; confirm whether nodemailer 9 ships built-in types or types remain compatible |

**No production TypeScript changes expected** unless nodemailer 9 typing or API requires adapter tweaks:

- `libs/infrastructure/src/mail/smtp-mail.adapter.ts` — `SmtpMailAdapter`, `createTransport`, `sendMail` (verify only)
- `libs/infrastructure/src/mail/null-mail.adapter.ts` — unchanged
- `apps/api/src/main.ts` — unchanged (no multer usage)

### 6. Verification commands

| Step                                    | Command                                        | Expected                              |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Clean install                           | `npm ci`                                       | exit 0                                |
| Audit gate                              | `npm audit --omit=dev --audit-level=high`      | **0 high**, exit 0                    |
| Full build                              | `npm run build`                                | exit 0                                |
| Lint                                    | `npm run lint`                                 | exit 0                                |
| Mail module                             | `npm run test:unit -- mail.module.spec`        | pass                                  |
| Email processor (integration)           | `npm run test:int -- email.processor.int-spec` | pass when PostgreSQL/Redis available  |
| Unit suite                              | `npm run test:unit`                            | pass                                  |
| Bootstrap (if Redis/Postgres available) | `npm run start:api`, `npm run start:worker`    | startup without mail/transport errors |

Record command / result / conclusion per `AGENTS.md` verification rules.

### 7. Risks and open questions

| Risk / question                           | Notes                                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodemailer` 8 → 9 breaking changes       | npm audit labels 9.0.1 as breaking; review [nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md) before approval |
| `@types/nodemailer@8.0.1` vs nodemailer 9 | No `@types/nodemailer@9` on npm; confirm built-in types or TS compatibility during implementation                                                    |
| `multer` override vs NestJS               | Patch bump 2.1.1 → 2.2.0 likely safe; verify no Nest platform-express regression; starter has no file-upload tests today                             |
| Downstream starter consumers              | `overrides` affect entire tree — document in plan/report for teams extending upload or custom mail                                                   |
| Residual moderate advisories              | After fix, re-run full `npm audit --omit=dev` without `--audit-level=high` to see if any moderate remain                                             |
| Compensating controls if override blocked | No upload endpoints; no `raw` mail — acceptable only as **temporary** exception with expiry date                                                     |

## Current behavior

Production dependency graph includes `multer@2.1.1` (transitive) and `nodemailer@8.0.11` (direct). `npm audit --omit=dev --audit-level=high` reports 8 high findings (2 root causes).

## Confirmed root cause

Pinned/vulnerable versions in lockfile:

1. `@nestjs/platform-express` depends on `multer@2.1.1` (< 2.2.0).
2. Direct `nodemailer@^8.0.11` resolves to 8.0.11 (<= 9.0.0).

## Dependency/runtime flow

```text
API bootstrap (apps/api/src/main.ts)
  -> NestFactory.create<NestExpressApplication>
    -> @nestjs/platform-express
      -> multer@2.1.1 (bundled; inactive without FileInterceptor)

Worker email side effect
  -> EmailProcessor.process
    -> TOKENS.EmailGateway
      -> SmtpMailAdapter.send
        -> nodemailer.Transporter.sendMail({ from, to, subject, html, text })
```

## Goal

Zero high-severity production advisories on `npm audit --omit=dev --audit-level=high` without unsafe `npm audit fix --force` or NestJS downgrade.

## Scope

- Upgrade `nodemailer` to patched 9.0.1+.
- Force `multer@2.2.0` via npm `overrides` until `@nestjs/platform-express` ships compatible dependency.
- Regenerate lockfile; run build, lint, unit tests, audit.

## Out of scope

- Moderate/low advisories unless discovered after high are cleared.
- Adding file-upload endpoints or upload limits (no upload routes exist).
- Refactoring mail architecture or adding SSRF integration tests.
- Docker/release packaging (`P2-10`).
- DevDependency audit cleanup.

## Files to create

None.

## Files to modify

- `package.json` — `dependencies.nodemailer`, new `overrides.multer`; possibly `devDependencies.@types/nodemailer`
- `package-lock.json` — lock refresh

## Files to delete

None.

## Contract and DI changes

None expected. `IEmailGateway` and mail module tokens unchanged.

## Implementation steps

1. Confirm issue open (`npm audit --omit=dev --audit-level=high` → 8 high).
2. Update `package.json`: `nodemailer` → `^9.0.1`; add `"overrides": { "multer": "2.2.0" }`.
3. Run `npm install`; verify lockfile shows `multer@2.2.0` and `nodemailer@9.0.1+`.
4. Resolve TypeScript types for nodemailer 9 if compile fails.
5. Run targeted mail unit tests, then full verification commands.
6. If audit still reports high, stop and revise plan (do not force-fix).

## Migration and rollout concerns

- Consumers run `npm ci` after merge; override applies automatically.
- No database or runtime config migration.
- Email and API behavior should be unchanged for current JSON/auth and templated mail flows.

## Targeted verification

```bash
npm audit --omit=dev --audit-level=high
npm run test:unit -- mail.module.spec
npm run build:api
npm run build:worker
```

## Full verification

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run build
npm run lint
npm run test:unit
```

Bootstrap API/Worker when infrastructure available (V-01 / V-02).

## Acceptance criteria

1. `npm audit --omit=dev --audit-level=high` reports **0 high** (matches P2-09 and V-01).
2. `multer` resolved at **2.2.0** in lockfile.
3. `nodemailer` resolved at **9.0.1+** in lockfile.
4. `npm run build`, `npm run lint`, `npm run test:unit` pass.
5. No unsafe `npm audit fix --force` or NestJS downgrade.
6. Exploitability reassessed if adapter code changes.

## Risks

See § Investigation notes — Risks and open questions.

## Rollback strategy

Revert `package.json` / `package-lock.json` commits; `npm ci`; re-run audit (expect 8 high restored).

## Open questions requiring human decision

1. Approve **`npm overrides` for multer** vs wait for upstream `@nestjs/platform-express` bump (timeline unknown).
2. Approve **nodemailer major bump** (8 → 9) given npm “breaking change” label — acceptable for starter kit direct dependency?
3. Should implementation add **`disableFileAccess` / `disableUrlAccess`** on `createTransport` as defense-in-depth (optional scope)?
