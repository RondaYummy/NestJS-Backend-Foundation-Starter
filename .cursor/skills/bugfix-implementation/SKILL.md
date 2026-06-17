---
name: bugfix-implementation
description: Implement exactly one human-approved bugfix plan with minimal scope, explicit DI updates and command evidence.
---

# Bugfix Implementation

## Required inputs

- one issue ID from `docs/agent-backlog/INDEX.md`;
- its source issue in `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`;
- one plan under `docs/agent-plans/`;
- current `git status` and `git diff`.

## Mandatory approval check

Read the plan frontmatter.

Proceed only when it contains:

```yaml
status: approved
```

If it is `proposed`, `rejected`, missing or ambiguous, do not edit production code. Report that human approval is required.

## Workflow

### 1. Revalidate the plan

- Confirm the source issue still exists.
- Confirm every planned file and symbol still matches the current branch.
- Confirm the working tree does not contain conflicting user changes.

### 2. Implement in phases

- Follow the plan in documented order.
- Modify only files in the approved scope.
- After a contract or token change, immediately update all implementations and consumers.
- Keep controllers, workers and schedules thin.
- Preserve independent API, Worker, Cron and Migrations composition.

After each logical phase:

1. inspect `git diff`;
2. run the narrowest relevant build or test;
3. verify no unrelated files changed.

### 3. Handle plan deviations

If implementation requires an unplanned breaking change, migration, dependency, new module or unrelated refactor:

- stop before making that change;
- report why the approved plan is insufficient;
- request a revised plan and human approval.

Do not silently update the approved plan.

### 4. Final verification

Run all plan-specific commands and, for shared architecture changes, at least:

```bash
npm run build
npm run lint
```

Run relevant tests and bootstrap checks when available.

### 5. Implementation report

Write:

```text
docs/agent-reports/<issue-id>-implementation.md
```

Use this structure:

```markdown
# <Issue ID> — Implementation report

## Verdict
implemented | partially-implemented | blocked

## Approved plan
## Changed files
## Completed steps
## Deviations
## Commands executed
## Command results
## Acceptance criteria self-check
## Remaining risks
## Unverified areas
```

Do not change the source backlog issue status. Human acceptance occurs only after independent verification.

## Guardrails

- Do not implement multiple issues together.
- Do not use broad `any`, `@ts-ignore` or disabled validation to pass checks.
- Do not change dependencies unless the approved plan requires it.
- Do not claim success for commands that were not executed.
- Do not destroy or overwrite user changes.
