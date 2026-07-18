---
name: verify-task
description: Independently verify one implemented new task without changing production code.
---

Use the `task-verifier` subagent and the `task-verification` skill.

Use exactly one `TASK-xxx` ID.

Read the approved specification, approved plan, actual diff and implementation report.
For HTTP endpoint changes, compare generated OpenAPI with controllers, DTO validation, responses, errors, auth, headers and cookies, then run the OpenAPI drift test.
Execute relevant verification commands.
Do not modify production code.

Create a verification report with verdict:

- `approved`;
- `changes-required`;
- `not-confirmed`.
