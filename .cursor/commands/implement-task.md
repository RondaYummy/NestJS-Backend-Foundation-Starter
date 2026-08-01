---
name: implement-task
description: Implement one new task from its human-approved specification and human-approved implementation plan.
---

Use the `task-implementer` subagent and the `task-implementation` skill.

Use exactly one `TASK-xxx` ID.

Do not edit production code unless both the task specification and matching plan contain:

```yaml
status: approved
```

Implement only the approved scope.
Update typed OpenAPI schemas/decorators and the Postman collection under `docs/postman/` in the same task as any HTTP endpoint change; run OpenAPI drift and `npm run test:postman-coverage` when applicable.
Run targeted and final verification commands.
Create an implementation report under `docs/agent-reports/`.
