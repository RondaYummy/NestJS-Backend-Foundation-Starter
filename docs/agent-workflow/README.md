# Cursor agent workflow

## Components

- `AGENTS.md` — repository-wide operating contract.
- `.cursor/rules/` — persistent or path-scoped constraints.
- `.cursor/skills/` — reusable multi-step procedures.
- `.cursor/agents/` — specialized roles with narrow authority.
- `.cursor/commands/` — short workflow entrypoints.
- `docs/agent-backlog/` — source issues and stable IDs.
- `docs/agent-plans/` — reviewable implementation plans.
- `docs/agent-reports/` — review, implementation and verification evidence.

## Standard bugfix flow

```text
/plan-fix P0-01
  -> review generated plan
  -> manually change status: proposed -> approved
/implement-fix P0-01
/verify-fix P0-01
  -> human accepts or requests corrections
```

## Full review flow

```text
/review-starter
```

The reviewer is read-only and writes the result to `docs/agent-reports/`.

## Human approval boundary

The architecture deliberately separates:

- planner;
- implementer;
- verifier;
- human approver.

The same agent must not plan, implement and approve its own work as one unreviewed operation.
