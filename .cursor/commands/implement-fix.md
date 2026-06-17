---
name: implement-fix
description: Implement one human-approved plan and produce an evidence-based implementation report.
---

Use the `bugfix-implementer` subagent and the `bugfix-implementation` skill.

Use exactly one issue ID and its matching plan under:

```text
docs/agent-plans/
```

Do not edit code unless plan frontmatter contains:

```yaml
status: approved
```

Implement only the approved scope, run required commands and create an implementation report under `docs/agent-reports/`.
