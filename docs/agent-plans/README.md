# Agent plans

This directory contains one implementation plan per bugfix issue or new task.

Naming convention:

```text
<id>-<short-slug>.md
```

Examples:

```text
P0-01-atomic-email-idempotency.md
TASK-001-password-reset.md
```

## Bugfix plan frontmatter

```yaml
---
issue_id: P0-01
status: proposed
owner: human-approval-required
---
```

## New-task plan frontmatter

```yaml
---
task_id: TASK-001
specification: docs/agent-tasks/TASK-001-password-reset.md
status: proposed
owner: human-approval-required
---
```

Allowed statuses:

- `proposed` — created by a planner and not approved;
- `approved` — manually approved by a human;
- `rejected` — rejected by a human;
- `superseded` — replaced by a newer plan.

Agents must never change `proposed` to `approved` themselves.
