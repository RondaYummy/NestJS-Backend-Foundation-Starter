---
name: plan-fix
description: Validate and plan one issue from the starter-kit backlog without editing production code.
---

Use the `bugfix-planner` subagent and the `bugfix-planning` skill.

Use exactly one issue ID supplied by the user from:

```text
docs/agent-backlog/INDEX.md
```

Confirm the issue still exists in the current branch.
Do not edit production code.
Create a proposed plan under `docs/agent-plans/` with exact file paths and acceptance criteria.
