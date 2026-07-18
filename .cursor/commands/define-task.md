---
name: define-task
description: Convert one new feature or technical request into a proposed, codebase-aware task specification without editing production code.
---

Use the `task-analyst` subagent and the `task-definition` skill.

Use the task description supplied by the user in the same message.

If the user does not provide a `TASK-xxx` ID, allocate the next available ID from:

```text
docs/agent-tasks/INDEX.md
```

Inspect the current repository before defining requirements.
If the request adds or changes an HTTP endpoint, include OpenAPI contract requirements and acceptance criteria for inputs, outputs, statuses, errors, auth, headers and cookies.
Do not edit production code.
Create one proposed specification under `docs/agent-tasks/`.
Update `docs/agent-tasks/INDEX.md`.
