---
name: verify-task
description: Independently verify one implemented new task without changing production code.
---

Use the `task-verifier` subagent and the `task-verification` skill.

Use exactly one `TASK-xxx` ID.

Read the approved specification, approved plan, actual diff and implementation report.
Execute relevant verification commands.
Do not modify production code.

Create a verification report with verdict:

- `approved`;
- `changes-required`;
- `not-confirmed`.
