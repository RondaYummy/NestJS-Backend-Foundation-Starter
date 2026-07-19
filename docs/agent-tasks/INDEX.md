# New task index

This index contains new features and technical tasks.

| Task ID  | Title                                                | Type           | Status   | Specification                                               |
| -------- | ---------------------------------------------------- | -------------- | -------- | ----------------------------------------------------------- |
| TASK-002 | API URI versioning (`/v1`, health version-neutral)   | technical      | proposed | `docs/agent-tasks/TASK-002-api-uri-versioning.md`           |
| TASK-003 | Password change and email reset                      | feature        | proposed | `docs/agent-tasks/TASK-003-change-password.md`              |
| TASK-004 | Optional Google SSO auth module                      | feature        | proposed | `docs/agent-tasks/TASK-004-google-sso-module.md`            |
| TASK-005 | Session management endpoints (`AUTH_DRIVER=session`) | feature        | proposed | `docs/agent-tasks/TASK-005-session-management-endpoints.md` |
| TASK-006 | Configure pino-pretty for development logs           | infrastructure | proposed | `docs/agent-tasks/TASK-006-pino-pretty-development.md`      |

## Rules

- IDs are sequential and must never be reused.
- `TASK-001` is retired; the next available ID is `TASK-007`.
- The task analyst adds a row when creating a specification.
- Only a human changes a task status to `approved` or `rejected`.
- Bugfix IDs such as `P0-01` do not belong in this index.
