---
issue_id: V-25
status: approved
owner: human-approval-required
---

# V-25 — README/.env examples work for both host-run local dev and Docker network startup

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — verification backlog row **V-25**:

> README/.env examples work for both host-run local dev and Docker network startup

**Linked defect:** **P3-05** (`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section P3-05, lines ~1617–1684).

**Investigation (2026-06-24, current branch):** verification scenario is **not stale**. The documentation/env-template mismatch from P3-05 is still present. V-25 cannot return `approved` until P3-05 is implemented and independently verified.

**Note on backlog index:** `docs/agent-backlog/INDEX.md` is deleted in the current working tree; V-25 remains listed in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md` (summary table line ~1750 and full P3-05 section ~1617–1684). No separate `docs/agent-plans/P3-05-*.md` implementation plan exists yet — implementation must follow this human-approved plan (or a P3-05-specific plan derived from it) before V-25 verification can pass.

## Current behavior

1. **`.env.example` defaults to Docker-internal hostnames only** (line 5–8):

   ```env
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app
   REDIS_HOST=redis
   ```

   Credentials match `docker-compose.yml` Postgres service (`POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=app`), but hostnames do **not** resolve when Node runs on the host OS.

2. **README §9 (Local development)** documents hybrid dev without hostname correction:

   - §9.2: `cp .env.example .env`
   - §9.3: `docker compose up -d postgres redis`
   - §9.4–§9.6: `npm run start:dev:api|worker|cron`

   After copy, host-run processes inherit `postgres` / `redis` hostnames → connection failure (`ENOTFOUND` or similar). **No `npm run db:migrate` step** appears in §9 (§8.4 documents migrations separately).

3. **README uses wrong DB credentials in multiple env blocks:**

   | Location | Value | Actual compose / `.env.example` |
   | -------- | ----- | ------------------------------- |
   | §8.3 (lines ~1747–1750) | `postgresql://app:app@postgres:5432/app` | `postgres:postgres` |
   | §21 host example (line ~2534) | `postgresql://app:app@localhost:5432/app` | `postgres:postgres` |
   | §21 Docker block (lines ~2595–2597) | `postgresql://app:app@postgres:5432/app` | `postgres:postgres` |

4. **`docker-compose.yml` dev stack** hardcodes Postgres credentials on the `postgres` service (lines 4–7) and loads `.env` via `env_file: .env` on `migrations`, `api`, `worker`, and `cron` (line 48+). There are **no `environment:` overrides** for `DATABASE_URL` or `REDIS_HOST` on app services — containers inherit hostnames directly from `.env`.

5. **`DOCKER_PRODUCTION.md`** (lines 5–9) instructs replacing `CHANGE_ME_*` placeholders after `cp .env.example .env`, but `.env.example` contains no `CHANGE_ME_*` keys. Production compose expects vars such as `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `APP_IMAGE`, and `REDIS_PASSWORD` that are not documented in `.env.example`.

6. **Release policy** (`scripts/release/release-policy.ts`) requires `.env.example` in archives and treats other `.env.*` files as forbidden unless explicitly allowlisted (line ~96: `fileName.startsWith('.env.') && fileName !== '.env.example'`). Split-template approach requires coordinated release-policy updates.

## Confirmed root cause

A **single `.env.example` plus README quickstart** optimizes for full Docker Compose (`postgres` / `redis` hostnames) while **§9 documents hybrid dev** (Docker infra + host `npm run start:dev:*`) without telling integrators to change hostnames. README also documents **`app:app`** credentials that do not match `docker-compose.yml` or `.env.example` (`postgres:postgres`).

## Dependency/runtime flow

### Current (broken — V-25 would fail today)

```text
cp .env.example .env
        │
        ├─ Host-run path (README §9)
        │     docker compose up -d postgres redis
        │     npm run start:dev:api|worker|cron
        │           └─ getRedisStartupConfig() → REDIS_HOST=redis (from .env)
        │           └─ AppConfigService → DATABASE_URL host=postgres
        │     ❌ host OS cannot resolve Docker service names
        │
        └─ Full Docker path (README §8)
              docker compose up --build
              migrations/api/worker/cron read env_file: .env
              ✓ postgres/redis hostnames work inside network
              ⚠ README §8.3 shows app:app — auth failure if followed literally
```

### Expected after P3-05 (V-25 pass condition)

```text
Integrator copies one documented template (or applies documented overrides)
        │
        ├─ Host-run hybrid: localhost hostnames + postgres:postgres creds
        │     docker compose up -d postgres redis
        │     npm run db:migrate
        │     npm run start:dev:*  → bootstrap succeeds
        │
        └─ Full Docker dev: postgres/redis hostnames (via template or compose overrides)
              docker compose up --build  → migrations + api/worker/cron healthy
```

**Symbols on the verification path (documentation/config only — no production TypeScript changes required):**

| Path | Symbol / responsibility |
| ---- | ----------------------- |
| `.env.example` | Canonical tracked env template; default hostnames and credentials |
| `docker-compose.yml` | `postgres` service env; optional `environment:` overrides on app services |
| `README.md` §8, §8.3, §8.4, §9, §21, §25 | Local dev and Docker quickstart flows; env examples |
| `DOCKER_PRODUCTION.md` | Production Docker env preparation |
| `scripts/release/release-policy.ts` | Archive allowlist if additional env templates added |
| `scripts/release/release-policy.spec.ts` | Release policy tests |
| `.dockerignore` | Build-context allow rules for env templates |
| `EXAMPLES.md` | Checklist references to `.env.example` (lines ~467, ~735) |

## Goal

Make documented local development work **without reverse engineering** for both:

1. **Host-run hybrid** — PostgreSQL/Redis in Docker, Nest entrypoints via `npm run start:dev:*` on the host.
2. **Full Docker dev** — all services including app containers via `docker compose up --build`.

Both modes must use **consistent credentials** (`postgres:postgres`, database `app`) aligned with `docker-compose.yml`.

## Scope

- Align `.env.example`, `README.md`, and `docker-compose.yml` dev stack for dual-mode local development.
- Fix contradictory `app:app` credential examples in README env blocks.
- Add missing `npm run db:migrate` step to README §9 host-run flow.
- Update `DOCKER_PRODUCTION.md` to remove stale `CHANGE_ME_*` guidance.
- Optionally add `docker-compose.yml` `environment:` overrides so one localhost-default `.env` works for both host-run and container-run (recommended strategy C below).
- Update release policy / `.dockerignore` / specs **only if** additional env template files are introduced.

## Out of scope

- Production TypeScript changes in `libs/` or `apps/` (unless compose override wiring requires none — it should not).
- **P2-16 / V-22** Redis startup typed-config unification (coordinate only: V-25 needs consistent `REDIS_HOST` in `.env`, not schema refactor).
- **P3-02** full README sync (entrypoints, EventBus, feature list).
- **P3-03** Outbox duplicate env comments and startup logging prefix (already partially addressed).
- Restoring `docs/agent-backlog/INDEX.md` (separate housekeeping).
- Marking P3-05 or V-25 resolved in backlog (implementer/verifier reports only).
- Production migration execution or changes to `docker-compose.prod.yml` beyond documentation alignment.

## Files to create

| File | Responsibility |
| ---- | -------------- |
| *(optional)* `.env.example.docker` | Docker-network hostnames (`postgres`, `redis`) if split-template strategy A is chosen |
| *(optional)* `.env.example.host` or `.env.example.local` | Localhost hostnames for host-run npm scripts if split-template strategy A is chosen |

**If no split files (recommended strategy C):** no new files.

## Files to modify

| File | Symbol / section | Change |
| ---- | ---------------- | ------ |
| `.env.example` | `DATABASE_URL`, `REDIS_HOST` | Default to **localhost** hostnames for host-run; add inline comments documenting Docker-network overrides (`postgres`, `redis`) |
| `docker-compose.yml` | `migrations`, `api`, `worker`, `cron` services | Add `environment:` overrides for `DATABASE_URL` and `REDIS_HOST` using Docker service names so localhost-default `.env` works inside containers (strategy C) |
| `README.md` | §8.1, §8.3 | Label full-Docker flow; fix credentials to `postgres:postgres`; explain compose override precedence if strategy C |
| `README.md` | §9.2–§9.6 | Rewrite as explicit host-run hybrid flow: correct template copy, infra startup, **`npm run db:migrate`**, then `start:dev:*` |
| `README.md` | §21 | Split labeled blocks: “Host-run (hybrid)” vs “Docker network (containers)”; remove all `app:app` examples |
| `README.md` | §25 (if env quickstart referenced) | Align with §8/§9 dual-flow wording |
| `DOCKER_PRODUCTION.md` | §1 | Remove `CHANGE_ME_*` instruction; document prod-only vars or point to README §21 |
| `EXAMPLES.md` | §8 checklist (~line 735) | Update if `cp` command or template name changes |
| `scripts/release/release-policy.ts` | `REQUIRED_ARCHIVE_ENTRIES`, deny rules | **Only if** split env templates added |
| `scripts/release/release-policy.spec.ts` | allowlist / forbidden path tests | **Only if** split env templates added |
| `.dockerignore` | `!.env.example.*` rules | **Only if** split env templates added |

## Files to delete

None.

## Contract and DI changes

None. This is documentation and env-template alignment only. No Nest modules, ports, tokens, or runtime contracts change.

## Implementation steps

### Step 0 — Human decision: template strategy

Choose one approach (plan recommends **C**):

| Strategy | Summary | Release-policy churn |
| -------- | ------- | -------------------- |
| **A — Split templates** | `.env.example.host` + `.env.example.docker`; README shows which to `cp` | Yes — update release policy, `.dockerignore`, specs |
| **B — Single template + docs** | `.env.example` defaults to localhost; README documents manual Docker overrides | No |
| **C — B + compose overrides** *(recommended)* | Same as B; `docker-compose.yml` sets `DATABASE_URL`/`REDIS_HOST` for app services | No |

**Recommendation:** Strategy **C** — smallest integrator friction (`cp .env.example .env` works for §9 immediately; `docker compose up` overrides hostnames inside network).

### Step 1 — Fix `.env.example` defaults

- Set `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app`
- Set `REDIS_HOST=localhost`
- Add short comments above those lines, e.g. “For full Docker Compose app services, use host `postgres` / `redis` — or rely on compose overrides (see README §8).”

### Step 2 — Add compose overrides (strategy C)

On `migrations`, `api`, `worker`, and `cron` in `docker-compose.yml`, add:

```yaml
environment:
  DATABASE_URL: postgresql://postgres:postgres@postgres:5432/app
  REDIS_HOST: redis
```

Document that these override `.env` values **inside containers only**; host-run processes continue using localhost from `.env`.

### Step 3 — Rewrite README §9 (host-run hybrid)

After §9.2, state explicitly: “This flow runs Nest on your host machine while PostgreSQL and Redis run in Docker.”

Insert between §9.3 and §9.4:

```bash
npm run db:migrate
```

Update §9.2 if strategy A: `cp .env.example.host .env` (otherwise keep `cp .env.example .env`).

### Step 4 — Fix README §8.3 and §21

- Replace every `app:app` with `postgres:postgres`.
- §8.3: show Docker-network values with correct credentials; note compose overrides if strategy C.
- §21: two labeled subsections — host-run example (`localhost`) and Docker-network example (`postgres`/`redis`).

### Step 5 — Align `DOCKER_PRODUCTION.md`

- Remove “Replace all `CHANGE_ME_*` values.”
- State that production uses `docker-compose.prod.yml` with vars documented in README §21 (or add commented prod-only keys to `.env.example` if human approves — see open questions).

### Step 6 — Release policy (strategy A only)

If split templates are chosen:

- Add new files to `REQUIRED_ARCHIVE_ENTRIES` or documented optional entries in `release-policy.ts`.
- Extend `.dockerignore` with `!.env.example.host` / `!.env.example.docker`.
- Update `release-policy.spec.ts` deny/allow tests.

### Step 7 — Static consistency sweep

```bash
rg "app:app@" README.md DOCKER_PRODUCTION.md
rg "DATABASE_URL|REDIS_HOST" .env.example README.md docker-compose.yml
```

Ensure no contradictory credential or hostname examples remain.

## Migration and rollout concerns

- **No database migration** required — documentation-only change.
- **Existing developer `.env` files** are not modified by this fix; integrators who already hand-edited hostnames are unaffected.
- **Compose override precedence:** Docker Compose merges `environment:` over `env_file`; document this in README §8 so operators understand why localhost `.env` still works in containers.
- **CI/agents without Docker:** runtime verification may be `not-confirmed` for Docker scenarios; static doc consistency checks still apply.

## Targeted verification

### Scenario A — Host-run hybrid (primary V-25 path)

```bash
cp .env.example .env
# Confirm: DATABASE_URL host=localhost, REDIS_HOST=localhost, creds postgres:postgres
docker compose up -d postgres redis
npm run db:migrate
npm run start:dev:api
# Expected: bootstrap succeeds; GET http://localhost:3000/health/live → 200
```

Repeat smoke for `npm run start:dev:worker` and `npm run start:dev:cron` if time permits (Cron/Worker need Redis only after migrate).

### Scenario B — Full Docker dev

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps
docker compose logs migrations
# Expected: migrations exit 0; api/worker/cron running
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health/live
# Expected: 200
```

### Scenario C — Documentation consistency (static)

```bash
rg "app:app@" README.md
# Expected: no matches

rg "postgresql://postgres:postgres@" README.md .env.example docker-compose.yml
# Expected: consistent credential story
```

### Scenario D — Release policy (if split templates or script changes)

```bash
npm run test:release
```

## Full verification

| Command | When required | Purpose |
| ------- | ------------- | ------- |
| Scenarios A + B above | Always (when Docker available) | V-25 runtime evidence |
| Scenario C | Always | Static doc gate |
| `npm run test:release` | If release scripts / `.dockerignore` changed | Policy regression |
| `npm run lint` | If any TS/script files changed | Lint gate |
| `npm run release:check` | Optional | Full release gate |

Record per V-25 matrix in `docs/agent-reports/V-25-verification.md`:

```text
Issue ID:
Command/scenario:
Expected result:
Actual result:
Exit code:
Evidence:
Verdict: approved | changes-required | not-confirmed
Unverified areas:
```

## Acceptance criteria

Mapped from **P3-05** and **V-25**:

- [ ] README has one canonical dev credential set: `postgres:postgres` / database `app` (no `app:app`)
- [ ] `.env.example` does not mislead host-run `npm run start:dev:*` (localhost hostnames by default, or explicit split template documented)
- [ ] README §9 host-run quickstart works: Docker infra + app on host, including `npm run db:migrate`, without manual hostname guessing
- [ ] README §8 full-Docker quickstart works with the same credential story
- [ ] `docker-compose.yml` and docs agree on DB user, password, and database name
- [ ] No contradictory `app:app` examples remain in README env blocks
- [ ] `DOCKER_PRODUCTION.md` matches actual `.env.example` content (no stale `CHANGE_ME_*` instruction)
- [ ] Independent verification report returns `approved` with runtime evidence for scenarios A and B (or documents infra unavailability separately from code/doc defects)

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Split env files break `release:check` / archive deny rules | Prefer strategy C; if splitting, update policy + specs in same change |
| Compose `environment:` overrides surprise operators | Document precedence explicitly in README §8.3 |
| P2-16 / V-22 still open — Redis startup reads raw `process.env` | V-25 only requires consistent `REDIS_HOST` in `.env`; flag coordination, do not block on V-22 |
| Docker daemon unavailable in verifier environment | Run static checks; mark Docker scenarios `not-confirmed` with explicit infra note |
| Scope creep into P3-02 README-wide rewrite | Limit edits to §8, §9, §21, §25 and directly linked env examples |

## Rollback strategy

Revert documentation and `docker-compose.yml` changes. No data migration or production runtime impact. Developers with working hand-edited `.env` files are unaffected.

## Open questions requiring human decision

1. **Template strategy:** Split files (A) vs single template + docs (B) vs **B + compose overrides (C)**? Plan recommends **C**.
2. **Default `cp` target:** Should `cp .env.example .env` optimize for host-run (§9) or Docker (§8)? Recommendation: **host-run** with compose overrides for §8.
3. **Production env in this change:** Add commented prod keys (`POSTGRES_USER`, `APP_IMAGE`, `REDIS_PASSWORD`, etc.) to `.env.example`, or limit to dev and fix `DOCKER_PRODUCTION.md` only?
4. **§9 migrate step:** Confirm inclusion of `npm run db:migrate` in acceptance (recommended **yes**).
5. **INDEX.md restoration:** Restore `docs/agent-backlog/INDEX.md` in this change or separate housekeeping?
