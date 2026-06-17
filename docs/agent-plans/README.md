# Agent plans

This directory contains one implementation plan per backlog issue.

Naming convention:

```text
<issue-id>-<short-slug>.md
```

Example:

```text
P0-01-atomic-email-idempotency.md
```

Required frontmatter:

```yaml
---
issue_id: P0-01
status: proposed
owner: human-approval-required
---
```

Allowed statuses:

- `proposed` — created by planner and not approved;
- `approved` — manually approved by a human;
- `rejected` — rejected by a human;
- `superseded` — replaced by a newer plan.

Agents must never change `proposed` to `approved` themselves.
