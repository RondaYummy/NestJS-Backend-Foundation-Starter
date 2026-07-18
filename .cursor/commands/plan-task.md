---
name: plan-task
description: Create one proposed implementation plan for a human-approved task specification without editing production code.
---

Use the `task-planner` subagent and the `task-planning` skill.

Use exactly one `TASK-xxx` ID supplied by the user.

Proceed only if the matching specification under `docs/agent-tasks/` contains:

```yaml
status: approved
```

Inspect the current codebase.
For HTTP endpoint changes, plan exact OpenAPI schema/decorator updates, canonical documentation changes and drift-test verification.
Do not edit production code.
Create one proposed plan under `docs/agent-plans/`.
