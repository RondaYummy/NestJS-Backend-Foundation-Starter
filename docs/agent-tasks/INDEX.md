# New task index

This index contains new features and technical tasks.

| Task ID  | Title                                                 | Type           | Status   | Specification                                          |
| -------- | ----------------------------------------------------- | -------------- | -------- | ------------------------------------------------------ |
| TASK-002 | Migration parity matrix and contract freeze           | documentation  | proposed | `docs/agent-tasks/TASK-002-migration-parity-matrix.md` |
| TASK-003 | Auth JWT cookie transport and /v1/auth parity         | feature        | proposed | `docs/agent-tasks/TASK-003-auth-v1-parity.md`          |
| TASK-004 | Extended user profile and /v1/users parity            | feature        | proposed | `docs/agent-tasks/TASK-004-users-profile-v1.md`        |
| TASK-005 | Cities domain search and seed                         | feature        | proposed | `docs/agent-tasks/TASK-005-cities-seed.md`             |
| TASK-006 | Storage composition for media uploads                 | infrastructure | proposed | `docs/agent-tasks/TASK-006-storage-media-wiring.md`    |
| TASK-007 | Campaigns core public and create flows                | feature        | proposed | `docs/agent-tasks/TASK-007-campaigns-core.md`          |
| TASK-008 | Campaign admin privileges services and workers mutate | feature        | proposed | `docs/agent-tasks/TASK-008-campaign-admin.md`          |
| TASK-009 | Workers public profile API                            | feature        | proposed | `docs/agent-tasks/TASK-009-workers-public-api.md`      |
| TASK-010 | Worker schedule and day exclusions                    | feature        | proposed | `docs/agent-tasks/TASK-010-schedule-v1.md`             |
| TASK-011 | Appointments booking and slot calculation             | feature        | proposed | `docs/agent-tasks/TASK-011-appointments-v1.md`         |
| TASK-012 | Comments and reviews                                  | feature        | proposed | `docs/agent-tasks/TASK-012-comments-v1.md`             |
| TASK-013 | Ranking recalculation Cron and Worker                 | feature        | proposed | `docs/agent-tasks/TASK-013-ranking-jobs.md`            |
| TASK-014 | Platform admin panel API                              | feature        | proposed | `docs/agent-tasks/TASK-014-platform-admin-v1.md`       |
| TASK-015 | In-app notifications and Socket.IO gateway            | feature        | proposed | `docs/agent-tasks/TASK-015-notifications-socketio.md`  |
| TASK-016 | Web Push subscriptions and delivery                   | feature        | proposed | `docs/agent-tasks/TASK-016-web-push.md`                |
| TASK-017 | Feedback public and admin persistence                 | feature        | proposed | `docs/agent-tasks/TASK-017-feedback-v1.md`             |
| TASK-018 | Fondy payments as-is                                  | feature        | proposed | `docs/agent-tasks/TASK-018-payments-fondy.md`          |
| TASK-019 | Public utilities status exchange aggregate search     | feature        | proposed | `docs/agent-tasks/TASK-019-public-utilities-v1.md`     |
| TASK-020 | Legacy database ETL into Drizzle schema               | infrastructure | proposed | `docs/agent-tasks/TASK-020-legacy-db-etl.md`           |
| TASK-021 | Staging parity smoke and cutover                      | infrastructure | proposed | `docs/agent-tasks/TASK-021-parity-smoke-cutover.md`    |

## Program overview

- Migration program (locked decisions D1–D6, dependency graph): `docs/agent-tasks/MIGRATION_PROGRAM.md`

## Rules

- IDs are sequential and must never be reused.
- `TASK-001` is retired.
- The next available ID is `TASK-022`.
- The task analyst adds a row when creating a specification.
- Only a human changes a task status to `approved`.
- Bugfix IDs such as `P0-01` do not belong in this index.
- Work on exactly one approved task at a time for planning/implementation/verification.
- Prefer approving and delivering tasks in dependency order from `MIGRATION_PROGRAM.md` (start with TASK-002).
