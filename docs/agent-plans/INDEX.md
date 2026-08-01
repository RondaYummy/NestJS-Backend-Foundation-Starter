# Agent plans index

This index lists implementation plans under `docs/agent-plans/`.

| ID    | Title                                                                  | Status   | Plan                                                                                                 |
| ----- | ---------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| P1-05 | Unwrap Drizzle unique violations so duplicate register returns 409     | proposed | [P1-05-unwrap-drizzle-unique-violation.md](./P1-05-unwrap-drizzle-unique-violation.md)               |
| P1-03 | Harden idempotency so side effects are not re-run after lock loss      | proposed | [P1-03-harden-idempotency-lock-loss.md](./P1-03-harden-idempotency-lock-loss.md)                     |
| P1-04 | Make JWT refresh-family revoke atomic                                  | proposed | [P1-04-atomic-jwt-refresh-family-revoke.md](./P1-04-atomic-jwt-refresh-family-revoke.md)             |
| P1-01 | Fix Redis session user-index TTL overwrite                             | approved | [P1-01-redis-session-user-index-ttl-overwrite.md](./P1-01-redis-session-user-index-ttl-overwrite.md) |
| P1-02 | Purge Redis sessions and JWT refresh families on password change/reset | proposed | [P1-02-purge-sessions-on-password-change.md](./P1-02-purge-sessions-on-password-change.md)           |

## Rules

- Plan filenames follow `<id>-<short-slug>.md` (see `README.md`).
- New-task plans use frontmatter `task_id`, `specification`, `status`, `owner`.
- Only a human changes plan status from `proposed` to `approved`.
- Do not overwrite an existing plan file for a different slug of the same ID; use a distinct slug.
- Bugfix plans (`P0-xx`, …) may also live here; keep them separate from `TASK-xxx` rows when present.
