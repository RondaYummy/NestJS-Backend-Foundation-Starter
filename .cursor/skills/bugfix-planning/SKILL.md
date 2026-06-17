---
name: bugfix-planning
description: Validate one backlog issue in the current branch and create a precise, reviewable implementation plan without editing production code.
---

# Bugfix Planning

## Input

The user must identify exactly one issue ID from:

```text
docs/agent-backlog/INDEX.md
```

Read the matching section in:

```text
docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md
```

## Workflow

### 1. Confirm current state

- Inspect `git status` and current diff.
- Read the issue completely.
- Inspect every referenced file and symbol.
- Search for all implementations, providers, exports and consumers of affected contracts.
- Confirm whether the root cause still exists in the current branch.

If the issue is already fixed or materially changed, write a stale-issue report instead of inventing a plan.

### 2. Determine change boundaries

Identify:

- current behavior;
- confirmed root cause;
- dependency/runtime flow;
- public API or contract changes;
- files to create, modify or delete;
- all affected composition roots;
- migration or rollout impact;
- compatibility risks;
- targeted and full verification commands.

### 3. Create the plan

Write:

```text
docs/agent-plans/<issue-id>-<short-slug>.md
```

Use this exact frontmatter:

```yaml
---
issue_id: P0-01
status: proposed
owner: human-approval-required
---
```

Use this structure:

```markdown
# <Issue ID> — <Title>

## Source issue
## Current behavior
## Confirmed root cause
## Dependency/runtime flow
## Goal
## Scope
## Out of scope
## Files to create
## Files to modify
## Files to delete
## Contract and DI changes
## Implementation steps
## Migration and rollout concerns
## Targeted verification
## Full verification
## Acceptance criteria
## Risks
## Rollback strategy
## Open questions requiring human decision
```

For every file, include the exact repository-relative path and the exact symbol or responsibility that changes.

## Approval gate

The planner must leave:

```yaml
status: proposed
```

Only a human may change it to:

```yaml
status: approved
```

## Guardrails

- Do not edit production files.
- Do not implement the fix.
- Do not combine several backlog issues.
- Do not expand into unrelated cleanup.
- Do not mark the backlog issue resolved.
- Do not hide uncertainty; list it under open questions or unverified areas.
