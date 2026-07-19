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

### 2. Collect human decisions for this task (mandatory gate)

Before writing the implementation plan file:

1. Extract every item from the specification section `Open questions requiring human decision`.
2. Add any new decisions discovered while inspecting the codebase that affect **this task only** (do not expand into other TASK IDs).
3. Present them to the human as a numbered decision list with:
   - what must be chosen;
   - concrete options (A/B/…);
   - a recommended default when one is safe;
   - what is blocked in the plan until answered.
4. **Stop and wait** for the human answers.
5. Only after answers are received, continue to design and write the plan. Record the decisions in the plan under `Open questions requiring human decision` as **Resolved** (decision + date/context), or leave truly still-open items explicit.

Do not invent answers. Do not bury unresolved choices inside implementation phases.

If the specification lists `None` under open questions, still ask only if codebase inspection surfaces a real in-scope decision; otherwise proceed.

### 3. Design the implementation

Determine:

- exact files to create, modify or delete;
- exact symbols, tokens, providers and exports affected;
- Domain, Application, Contracts, Infrastructure and Interface changes;
- API, DTO, event, queue or CLI contract changes;
- exact OpenAPI decorator/schema files, canonical documentation updates and drift-test checks for every HTTP endpoint addition or change;
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

### 4. Create the implementation plan

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

List resolved decisions from the planning gate, and any remaining blockers.
```

Every implementation phase must:

- list exact repository-relative paths;
- list exact symbols or responsibilities;
- map to one or more specification acceptance criteria;
- define a verification step.

### 5. Acceptance criteria mapping

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
- Do not finalize a plan while in-scope human decisions for this task remain unanswered; ask first, then write the plan.
- Do not create commits or switch branches unless explicitly requested.
