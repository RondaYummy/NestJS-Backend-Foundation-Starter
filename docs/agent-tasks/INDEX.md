# New task index

This index contains new features and technical tasks.

| Task ID  | Title                                                | Type           | Status   | Specification                                               |
| -------- | ---------------------------------------------------- | -------------- | -------- | ----------------------------------------------------------- |
| TASK-002 | API URI versioning (`/v1`, health version-neutral)   | technical      | approved  | `docs/agent-tasks/TASK-002-api-uri-versioning.md`           |
| TASK-003 | Password change and email reset                      | feature        | approved  | `docs/agent-tasks/TASK-003-change-password.md`              |
| TASK-004 | Optional Google SSO auth module                      | feature        | approved  | `docs/agent-tasks/TASK-004-google-sso-module.md`            |
| TASK-005 | Session management endpoints (`AUTH_DRIVER=session`) | feature        | approved  | `docs/agent-tasks/TASK-005-session-management-endpoints.md` |
| TASK-006 | Configure pino-pretty for development logs           | infrastructure | approved  | `docs/agent-tasks/TASK-006-pino-pretty-development.md`      |
| TASK-007 | LoggerModule portable configuration                  | refactor       | approved  | `docs/agent-tasks/TASK-007-logger-module-portability.md`   |
| TASK-008 | RateLimiterModule typed defaults                     | refactor       | approved  | `docs/agent-tasks/TASK-008-rate-limiter-typed-defaults.md` |
| TASK-009 | EventsModule configurable handlers                   | refactor       | approved  | `docs/agent-tasks/TASK-009-events-module-handler-injection.md` |
| TASK-010 | Module reuse / extraction strategy                   | infrastructure | approved  | `docs/agent-tasks/TASK-010-module-extraction-strategy.md`  |

## Rules

- IDs are sequential and must never be reused.
- `TASK-001` is retired; the next available ID is `TASK-011`.
- The task analyst adds a row when creating a specification.
- Only a human changes a task status to `approved` or `rejected`.
- Bugfix IDs such as `P0-01` do not belong in this index.
