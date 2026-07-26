# Agent plans index

This index lists implementation plans under `docs/agent-plans/`.

| ID       | Title                                                | Status   | Plan                                                                  |
| -------- | ---------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| TASK-002 | API URI versioning (`/v1`, health version-neutral)   | proposed | `docs/agent-plans/TASK-002-api-uri-versioning.md`                     |
| TASK-003 | Password change and email reset                      | proposed | `docs/agent-plans/TASK-003-change-password.md`                        |
| TASK-004 | Optional Google SSO auth module                      | proposed | `docs/agent-plans/TASK-004-google-sso-module.md`                      |
| TASK-005 | Session management endpoints (`AUTH_DRIVER=session`) | proposed | `docs/agent-plans/TASK-005-session-management-endpoints.md`           |
| TASK-006 | Configure pino-pretty for development logs           | proposed | `docs/agent-plans/TASK-006-pino-pretty-development.md`                |
| TASK-007 | LoggerModule portable configuration                  | approved | `docs/agent-plans/TASK-007-logger-module-portability.md`              |
| TASK-008 | RateLimiterModule typed defaults                     | approved | `docs/agent-plans/TASK-008-rate-limiter-typed-defaults.md`            |
| TASK-009 | EventsModule configurable handlers                   | approved | `docs/agent-plans/TASK-009-events-module-handler-injection.md`        |
| TASK-010 | Module reuse / extraction strategy                   | approved | `docs/agent-plans/TASK-010-module-extraction-strategy.md`             |
| TASK-011 | ExceptionsModule AppLogger peer + deprecated facades | proposed | `docs/agent-plans/TASK-011-exceptions-peer-and-deprecated-facades.md` |

## Rules

- Plan filenames follow `<id>-<short-slug>.md` (see `README.md`).
- New-task plans use frontmatter `task_id`, `specification`, `status`, `owner`.
- Only a human changes plan status from `proposed` to `approved`.
- Do not overwrite an existing plan file for a different slug of the same ID; use a distinct slug.
- Bugfix plans (`P0-xx`, …) may also live here; keep them separate from `TASK-xxx` rows when present.
