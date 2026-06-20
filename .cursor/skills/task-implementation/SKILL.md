---
name: task-implementation
description: Implement exactly one human-approved new task from its approved specification and approved plan, with minimal scope and command evidence.
---

# Task Implementation

## Required inputs

Use exactly one task ID.

Read:

1. the task entry in `docs/agent-tasks/INDEX.md`;
2. the task specification under `docs/agent-tasks/`;
3. the matching plan under `docs/agent-plans/`;
4. current `git status` and `git diff`.

## Mandatory approval checks

Proceed only when both files contain:

```yaml
status: approved
```

Required approvals:

- task specification: approved;
- implementation plan: approved.

If either approval is missing:

- do not edit production code;
- report the exact missing approval;
- do not create a successful implementation report.

## Workflow

### 1. Revalidate before editing

- Confirm the current branch still matches the approved specification and plan.
- Inspect the working tree for conflicting user changes.
- Confirm all planned paths and symbols exist or are intentionally new.
- Recheck all consumers before changing contracts, tokens, DTOs or schemas.
- Confirm the plan covers every acceptance criterion.

If a material plan deviation is required, stop and request a revised plan.

### 2. Implement in approved phases

Follow the plan in order.

For each phase:

1. implement only the approved files and symbols;
2. update contracts, implementations, providers, exports and consumers together;
3. keep controllers, processors, cron handlers and CLI handlers thin;
4. preserve independent API, Worker, Cron and Migrations composition;
5. add or update documentation when public behavior changes;
6. add or update tests where the repository has an applicable testing pattern or the plan requires them;
7. inspect `git diff`;
8. run the narrowest relevant verification.

### 3. Database and migration discipline

When the task changes persistence:

- use a new migration;
- do not rewrite already-applied production migrations;
- keep application and migration rollout order compatible;
- do not run migrations against unknown or production databases;
- document data backfill or rollback limitations.

### 4. Scope deviation handling

Stop before proceeding when implementation requires:

- an unplanned breaking API change;
- a new external dependency;
- an unplanned migration;
- an unplanned security decision;
- an unrelated refactor;
- removal of an approved acceptance criterion.

Report the deviation and request a revised plan plus human approval.

### 5. Final verification

Run every command from the approved plan.

For shared architecture changes, run at least:

```bash
npm run build
npm run lint
```

Run relevant tests, migrations and entrypoint bootstrap checks when required and safe.

### 6. Implementation report

Create:

```text
docs/agent-reports/<task-id>-implementation.md
```

Use this structure:

```markdown
# <Task ID> — Implementation report

## Verdict
implemented | partially-implemented | blocked

## Approved specification
## Approved plan
## Changed files
## Completed phases
## Acceptance criteria self-check
## Contract and DI changes
## Database and migration changes
## Commands executed
## Command results
## Deviations
## Documentation changes
## Remaining risks
## Unverified areas
```

Before marking `implemented`, execute:

```bash
git diff --name-only
git diff --stat
```

The report's changed-file list must match the actual diff.

## Guardrails

- Do not implement more than one task.
- Do not approve your own work.
- Do not silently change the task specification or plan.
- Do not use broad `any`, `@ts-ignore`, disabled rules, removed validation or swallowed errors to pass checks.
- Do not claim commands passed when they were not executed.
- Do not create commits, push, switch branches or rewrite history unless the user explicitly asks.
- Do not report successful implementation when only documentation reports were created and the plan required production changes.
