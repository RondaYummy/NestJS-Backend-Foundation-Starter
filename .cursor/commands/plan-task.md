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

**Human decision gate (required):** Before creating the plan file, list every in-scope decision the human must make for this task (from the specification open questions plus any new ones found in code). Present options and a recommended default. Stop and wait for answers. Only then write the proposed plan, recording resolutions.

Do not edit production code.
Create one proposed plan under `docs/agent-plans/`.
