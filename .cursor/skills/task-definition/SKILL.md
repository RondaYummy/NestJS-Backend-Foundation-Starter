---
name: task-definition
description: Convert one new feature or technical request into a codebase-aware, human-approvable task specification without editing production code.
---

# Task Definition

## Use this skill when

Use this skill for new work that is not a confirmed bugfix, including:

- a new business feature;
- a new reusable module;
- a new integration;
- a technical improvement;
- a planned refactor;
- infrastructure work;
- documentation work with defined deliverables.

Confirmed defects from `docs/agent-backlog/` must use the bugfix workflow instead.

## Input

The user provides a task description.

The description may include an existing task ID. If it does not, allocate the next available ID in this format:

```text
TASK-001
TASK-002
TASK-003
```

Determine the next ID by reading:

```text
docs/agent-tasks/INDEX.md
```

Never reuse an existing ID.

## Workflow

### 1. Inspect repository context

Before writing the specification:

- read `AGENTS.md`;
- read `README.md`, `MODULES_OVERVIEW_NON_TECH.md` and `EXAMPLES.md` when architecture or public usage is affected;
- inspect the current Git status and diff;
- inspect the modules, contracts, entrypoints and existing patterns related to the request;
- search for existing capabilities that may already satisfy part of the task;
- identify whether the request is actually a bugfix and should use the bugfix workflow.

Do not edit production code.

### 2. Resolve task boundaries

Classify the task as one of:

- `feature`;
- `technical`;
- `refactor`;
- `infrastructure`;
- `documentation`.

Identify:

- the problem or opportunity;
- target users or runtime actors;
- desired observable behavior;
- functional requirements;
- non-functional requirements;
- architecture boundaries;
- API, event, queue or CLI contracts;
- for every added or changed HTTP endpoint, OpenAPI requirements and acceptance criteria covering inputs, outputs, statuses, errors, auth, headers and cookies;
- data model and migration needs;
- security and authorization requirements;
- entrypoints affected;
- compatibility requirements;
- rollout and rollback constraints;
- explicit out-of-scope items;
- assumptions;
- decisions requiring human input.

Do not invent missing business behavior. Put unresolved choices under `Open questions requiring human decision`.

### 3. Create the task specification

Create:

```text
docs/agent-tasks/<task-id>-<short-slug>.md
```

Use this exact frontmatter:

```yaml
---
task_id: TASK-001
task_type: feature
status: proposed
owner: human-approval-required
---
```

Use this structure:

```markdown
# <Task ID> — <Title>

## Original request

## Problem or opportunity

## Goal

## Users and actors

## Current system context

## Functional requirements

## Non-functional requirements

## Public API and interface impact

## Data model and migration impact

## Events, queues and background processing

## Security and authorization

## Entrypoints and deployment impact

## Observability and operations

## Compatibility requirements

## Dependencies

## Assumptions

## Out of scope

## Acceptance criteria

## Verification strategy

## Rollout and rollback

## Open questions requiring human decision
```

Requirements must be testable and numbered:

```text
FR-01
FR-02
NFR-01
AC-01
AC-02
```

### 4. Update the task index

Add one row to:

```text
docs/agent-tasks/INDEX.md
```

The row must contain:

- task ID;
- title;
- type;
- status;
- specification path.

The task analyst may update only documentation files related to task definition.

## Approval gate

Leave specification status as:

```yaml
status: proposed
```

Only a human may change it to:

```yaml
status: approved
```

A task planner must not plan an unapproved specification.

## Output

Return:

- task ID;
- specification path;
- important assumptions;
- open human decisions;
- files inspected;
- confirmation that production code was not changed.

## Guardrails

- Do not edit production code.
- Do not create an implementation plan.
- Do not approve the specification.
- Do not combine unrelated requests into one task.
- Do not hide uncertainty.
- Do not treat implementation details as approved requirements.
- Do not create commits or switch branches unless the user explicitly asks.
