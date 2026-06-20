---
name: task-planning
description: Create a precise implementation plan for one human-approved new-task specification without editing production code.
---

# Task Planning

## Required input

Use exactly one task ID from:

```text
docs/agent-tasks/INDEX.md
```

Read its specification under:

```text
docs/agent-tasks/
```

## Mandatory specification approval check

Proceed only if the task specification frontmatter contains:

```yaml
status: approved
```

If the specification is `proposed`, `rejected`, `superseded`, missing, or ambiguous:

- do not edit production code;
- do not create an implementation plan that appears ready for execution;
- report that human specification approval is required.

## Workflow

### 1. Revalidate the approved specification

- Read the specification completely.
- Inspect current `git status` and `git diff`.
- Inspect all related modules, entrypoints, contracts, providers, adapters and documentation.
- Confirm that the specification still matches the current branch.
- Find existing patterns that should be reused.
- Identify contradictions between specification, code and documentation.

Do not silently change approved requirements.

### 2. Design the implementation

Determine:

- exact files to create, modify or delete;
- exact symbols, tokens, providers and exports affected;
- Domain, Application, Contracts, Infrastructure and Interface changes;
- API, DTO, event, queue or CLI contract changes;
- database schema and migration sequence;
- transaction and Outbox boundaries;
- idempotency and retry behavior;
- Auth, permission and security impact;
- API, Worker, Cron and Migrations composition changes;
- logging, metrics, tracing and health impact;
- dependency changes;
- backward compatibility;
- rollout and rollback;
- targeted and full verification commands.

### 3. Create the implementation plan

Create:

```text
docs/agent-plans/<task-id>-<short-slug>.md
```

Use this exact frontmatter:

```yaml
---
task_id: TASK-001
specification: docs/agent-tasks/TASK-001-short-slug.md
status: proposed
owner: human-approval-required
---
```

Use this structure:

```markdown
# <Task ID> — Implementation plan

## Approved specification
## Current implementation
## Architecture decision
## Scope
## Out of scope
## Files to create
## Files to modify
## Files to delete
## Domain changes
## Application changes
## Contract and DI changes
## Infrastructure changes
## Interface and entrypoint changes
## Database and migration changes
## Security and authorization changes
## Observability changes
## Implementation phases
## Dependency and compatibility impact
## Targeted verification
## Full verification
## Acceptance criteria mapping
## Rollout strategy
## Rollback strategy
## Risks
## Open questions requiring human decision
```

Every implementation phase must:

- list exact repository-relative paths;
- list exact symbols or responsibilities;
- map to one or more specification acceptance criteria;
- define a verification step.

### 4. Acceptance criteria mapping

Create a matrix:

```text
AC-01 -> implementation phase -> verification command or inspection
AC-02 -> implementation phase -> verification command or inspection
```

No acceptance criterion may be silently omitted.

## Approval gate

Leave plan status as:

```yaml
status: proposed
```

Only a human may change it to:

```yaml
status: approved
```

## Guardrails

- Do not edit production code.
- Do not approve the plan.
- Do not change the approved task specification.
- Do not add unrelated refactoring.
- Do not invent APIs, tables or behavior that the specification does not require.
- If the specification is insufficient, stop and request a specification revision.
- Do not create commits or switch branches unless explicitly requested.
