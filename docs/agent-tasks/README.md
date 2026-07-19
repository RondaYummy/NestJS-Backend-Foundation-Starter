# Agent tasks

This directory is the source of truth for new work that is not a confirmed bugfix.

Use task IDs in this format:

```text
TASK-001
TASK-002
TASK-003
```

Supported task types:

- `feature` — new externally observable capability;
- `technical` — internal engineering capability or improvement;
- `refactor` — planned structural change without intended behavior change;
- `infrastructure` — deployment, runtime, observability or platform work;
- `documentation` — documentation with explicit deliverables and acceptance criteria.

Confirmed defects from `docs/agent-backlog/` continue to use the bugfix workflow and P-level IDs.

For the OLD_BACKEND → starter migration, see:

- `docs/agent-tasks/MIGRATION_PROGRAM.md` — locked decisions and dependency order
- `docs/agent-tasks/INDEX.md` — TASK-002…TASK-021 specifications

## Lifecycle

```text
rough request
  -> /define-task
  -> proposed task specification
  -> human approves specification
  -> /plan-task TASK-xxx
  -> proposed implementation plan
  -> human approves plan
  -> /implement-task TASK-xxx
  -> /verify-task TASK-xxx in a new chat
  -> human acceptance
```

## Specification status

Allowed values:

- `proposed` — created by the task analyst;
- `approved` — manually approved by a human;
- `rejected` — rejected by a human;
- `superseded` — replaced by a newer specification.

Agents must never change `proposed` to `approved`.

## Naming

```text
TASK-001-short-slug.md
```

Each specification must contain numbered requirements and acceptance criteria.

Any task that adds or changes an HTTP endpoint must treat the generated OpenAPI document as the canonical contract and include requirements and acceptance criteria for its inputs, outputs, statuses, errors, auth, headers and cookies.
