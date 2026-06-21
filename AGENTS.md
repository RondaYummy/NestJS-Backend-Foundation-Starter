# AGENTS.md

## Purpose

This repository is a reusable NestJS backend foundation, not a single business application.
Agents must preserve its portability, explicit dependency direction, independent entrypoints and production-safe behavior.

## Required reading order

Before changing architecture, dependency injection, configuration, queues, transactions, Outbox, Auth or runtime composition, read:

1. `README.md`
2. `MODULES_OVERVIEW_NON_TECH.md`
3. `EXAMPLES.md`
4. `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`
5. `docs/agent-backlog/INDEX.md`
6. the selected issue in `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`

Do not assume documentation is correct when code or runtime evidence contradicts it.

## Runtime entrypoints

### API

- Bootstrap: `apps/api/src/main.ts`
- Root module: `apps/api/src/api.module.ts`
- Application composition: `apps/api/src/composition/auth-application.module.ts`
- Purpose: HTTP controllers, DTO validation, guards, presenters and health endpoints.
- Must not start BullMQ consumers or cron schedules.

### Worker

- Bootstrap: `apps/worker/src/main.ts`
- Root module: `apps/worker/src/worker.module.ts`
- Processors: `apps/worker/src/processors/`
- Purpose: BullMQ consumers and background side effects.
- Must not create an HTTP server or cron scheduler.

### Cron

- Bootstrap: `apps/cron/src/main.ts`
- Root module: `apps/cron/src/cron.module.ts`
- Schedules: `apps/cron/src/schedules/`
- Purpose: scheduled orchestration and enqueueing technical jobs under distributed locks.
- Must not host HTTP controllers or unrelated BullMQ consumers.

### Migrations

- Bootstrap: `apps/migrations/src/main.ts`
- Purpose: production migration execution as a dedicated **one-shot deployment job** (not an API, Worker, or Cron startup side effect).
- Serializes concurrent migration attempts against the same PostgreSQL database via a session-level advisory lock with bounded lock and statement timeouts.
- Must never be run against an unknown or production database without explicit human approval.

## Architectural layers

### Domain — `libs/domain/src`

Pure business model:

- entities;
- value objects;
- domain events;
- domain errors.

Domain must not import NestJS, Drizzle, PostgreSQL, Redis, BullMQ, HTTP or provider SDKs.

### Application — `libs/application/src`

Application use cases and application DTOs.

Application may depend on Domain and Contracts. It must not import concrete infrastructure implementations.
Application use cases are plain TypeScript classes with port-typed constructors; Nest DI wiring belongs in composition roots only.

### Contracts — `libs/contracts/src`

Stable ports, tokens and cross-boundary data contracts used by Application and implemented by Infrastructure.

Contracts must not expose provider-specific implementation types.

### Infrastructure — `libs/infrastructure/src`

Adapters and runtime integration:

- config;
- logger;
- PostgreSQL and Drizzle;
- Redis;
- BullMQ;
- repositories;
- transactions;
- Outbox;
- events;
- mail;
- storage;
- rate limiting;
- distributed locks;
- idempotency;
- health;
- exception mapping.

Infrastructure implements Contracts and is composed by entrypoint root modules.

### Shared — `libs/shared/src`

Framework-neutral technical utilities with no business ownership and no infrastructure lifecycle.

## Dependency direction

Allowed direction:

```text
apps/interface -> application -> domain
       |               |
       v               v
 infrastructure -> contracts
```

Enforced rules:

- `domain` imports only Domain or framework-neutral Shared code;
- `application` imports Domain, Contracts and narrowly justified Shared code;
- `contracts` must remain provider-neutral;
- `infrastructure` may import Contracts, Domain mapping types and Shared utilities;
- `apps` act as composition roots and interface adapters;
- concrete adapters are registered against tokens in composition modules.

## Package manager and commands

- Node.js: `>=22.22.1 <25`
- npm: `>=10`
- Clean install: `npm ci`

Verification commands:

```bash
npm run build
npm run build:api
npm run build:worker
npm run build:cron
npm run build:migrations
npm run lint
npm run test:unit
npm run test:int
```

Local entrypoint commands:

```bash
npm run start:api
npm run start:worker
npm run start:cron
```

Migration commands:

```bash
npm run db:generate
npm run db:migrate
npm run db:migrate:prod
```

Do not run migration commands unless the task requires them and the target database is known and safe.

## Agent workflow

One issue must pass through these stages:

```text
backlog issue
  -> read-only investigation
  -> proposed plan
  -> human changes plan status to approved
  -> implementation
  -> independent verification
  -> human acceptance
```

### Planning

- Work on exactly one issue ID from `docs/agent-backlog/INDEX.md`.
- Confirm the issue still exists in the current branch.
- Do not edit production files.
- Write a plan under `docs/agent-plans/`.
- Set plan status to `proposed`.

### Approval

Only a human may change plan frontmatter from:

```yaml
status: proposed
```

to:

```yaml
status: approved
```

An implementation agent must not implement an unapproved plan.

### Implementation

- Implement exactly one approved plan.
- Do not mix unrelated backlog issues.
- Do not silently expand scope.
- Do not rewrite architecture when a local fix is sufficient.
- Run targeted verification during implementation and the full required verification before completion.

### Verification

- Verification must be independent from implementation.
- Inspect actual code and actual diff, not only the implementer report.
- Do not modify code while verifying.
- Report `approved`, `changes-required` or `not-confirmed`.

## Change discipline

- Read the current implementation before editing.
- Search all consumers before changing a contract or token.
- Update imports, providers, exports and composition roots together.
- Preserve backward compatibility unless the approved plan explicitly allows a breaking change.
- Do not change `package-lock.json` unless dependencies intentionally changed.
- Do not use broad `any`, `@ts-ignore`, disabled lint rules or deleted validation to make checks pass.
- Do not claim a command passed unless it was actually executed successfully.
- Separate project defects from missing PostgreSQL, Redis, SMTP, S3 or other external infrastructure.

## Prohibited destructive actions

Never execute without explicit human approval:

- production migrations;
- destructive SQL;
- `docker compose down -v`;
- deletion of Docker volumes;
- `git reset --hard`;
- forced pushes;
- rewriting user commits;
- deleting untracked user files;
- modifying real secrets in `.env`;
- commands pointing to production services.

## Definition of done for a bugfix

A fix is complete only when:

1. the original root cause is addressed;
2. the implementation matches the approved plan;
3. all affected consumers and registrations are updated;
4. every acceptance criterion is checked;
5. relevant build, lint, test and bootstrap checks are executed;
6. public behavior and documentation remain aligned;
7. remaining risks and unverified areas are explicitly reported.

## New task workflow

New work that is not a confirmed defect uses stable task IDs:

```text
TASK-001
TASK-002
TASK-003
```

Task specifications are stored under:

```text
docs/agent-tasks/
```

Supported task types:

- feature;
- technical;
- refactor;
- infrastructure;
- documentation.

The required lifecycle is:

```text
rough request
  -> proposed task specification
  -> human specification approval
  -> proposed implementation plan
  -> human plan approval
  -> implementation
  -> independent verification
  -> human acceptance
```

### Task definition

- Use exactly one new request.
- Inspect the current codebase before defining requirements.
- Do not edit production code.
- Create a specification under `docs/agent-tasks/`.
- Update `docs/agent-tasks/INDEX.md`.
- Leave specification status as `proposed`.

### Task specification approval

Only a human may change:

```yaml
status: proposed
```

to:

```yaml
status: approved
```

A task planner must not plan an unapproved specification.

### Task planning

- Work on exactly one approved `TASK-xxx` specification.
- Do not edit production code.
- Map every acceptance criterion to implementation steps and verification.
- Create a plan under `docs/agent-plans/`.
- Leave plan status as `proposed`.

### Task implementation

- Implement only when both specification and plan are human-approved.
- Do not change approved requirements silently.
- Do not combine another task or backlog issue.
- Stop and request a revised plan when a material unplanned change is required.

### Task verification

- Use a fresh verifier context when possible.
- Verify approved requirements, approved plan, actual diff and runtime evidence.
- Do not modify implementation code.
- Return `approved`, `changes-required` or `not-confirmed`.

## Definition of done for a new task

A new task is complete only when:

1. its specification is human-approved;
2. its implementation plan is human-approved;
3. all approved requirements and acceptance criteria are implemented;
4. all affected contracts, providers, consumers and entrypoints are consistent;
5. migrations and rollout behavior are safe where applicable;
6. required build, lint, test and bootstrap checks are executed;
7. public behavior and documentation are aligned;
8. independent verification returns `approved`;
9. remaining risks and unverified areas are explicitly documented.
