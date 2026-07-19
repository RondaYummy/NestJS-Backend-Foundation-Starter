# OLD_BACKEND → NestJS Starter migration program

Program overview for migrating the legacy NestJS business backend (`OLD_BACKEND/`) into this starter kit while preserving client-observable behavior behind a `/v1` compatibility layer.

## Locked human decisions

| ID     | Decision                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **C** — keep `/v1` compatibility controllers/adapters over new application use cases; new internal envelope may exist underneath                                                                                                    |
| **D2** | **B** — use starter auth model (`AUTH_DRIVER=jwt`); optional **cookie transport** for access/refresh (configurable names, may match `auth-cookie` / `refresh-cookie` for FE). Not a third auth driver; not dual jwt+session engines |
| **D3** | **A** — new Drizzle schemas + one-time ETL from the legacy PostgreSQL database                                                                                                                                                      |
| **D4** | Socket.IO notifications hosted so behavior matches OLD (API process is acceptable); Redis adapter only if multi-instance is required later                                                                                          |
| **D5** | Migrate **all** OLD capabilities, including unfinished/disabled paths (Fondy, feedback persistence quirks, VIP stub, admin backend-logs), documented as as-is                                                                       |
| **D6** | **Yes** — fix known security/correctness defects during migration (do not preserve password leaks, author spoofing, or Error-as-200 as intentional contracts)                                                                       |

## Architecture rules for every task

- Layers: Domain → Application → Contracts ← Infrastructure; apps are composition roots only.
- Entrypoints stay split: API (HTTP + optional Socket.IO), Worker (queues/side effects), Cron (schedule + enqueue under lock), Migrations (schema/ETL jobs).
- Side effects (mail, push, ranking recalculation): prefer Outbox → BullMQ Worker.
- Every new/changed HTTP route: typed OpenAPI + drift test alignment.
- Do not reintroduce TypeORM beside Drizzle.
- Do not use `synchronize: true` or bootstrap-time city/admin seed in the API process; use Migrations or explicit jobs.

## Source of truth

- Legacy behavior: `OLD_BACKEND/` (controllers, services, entities).
- Target patterns: `AGENTS.md`, `EXAMPLES.md`, existing Auth/Outbox/Mail/Storage.
- Per-slice requirements: individual `TASK-xxx` specs below.
- API parity checklist: produced by **TASK-002** and updated as slices land.

## Task dependency order

```text
TASK-002 (parity matrix / program freeze)
    │
    ├─► TASK-003 Auth + cookie transport + /v1/auth
    ├─► TASK-004 Users / profile / password restore
    ├─► TASK-005 Cities + seed
    └─► TASK-006 Storage wiring
            │
            ├─► TASK-007 Campaigns core (public + create/media/QR)
            ├─► TASK-008 Campaign admin / privileges / services
            └─► TASK-009 Workers public API
                    │
                    ├─► TASK-010 Schedule
                    └─► TASK-011 Appointments
                            │
                            ├─► TASK-012 Comments
                            └─► TASK-013 Ranking (Cron + Worker)
                                    │
                    TASK-014 Platform admin ──┤
                    TASK-015 Notifications + WebSocket
                    TASK-016 Web Push
                    TASK-017 Feedback
                    TASK-018 Payments (Fondy as-is)
                    TASK-019 Utilities (status, exchange, aggregate search)
                            │
                            └─► TASK-020 ETL data migration
                                    └─► TASK-021 Staging parity + cutover
```

Parallelism allowed after TASK-002: TASK-003…006; after campaigns base: comments vs admin lists; notifications/push after user+notification persistence exists.

## Out of program scope

- Frontend rewrite (except cookie/auth client adjustments implied by D2).
- Replacing Socket.IO with another realtime stack.
- Preserving TypeORM or monolithic AppModule structure.

## Task catalog

| ID       | Title                                    | Spec                                  |
| -------- | ---------------------------------------- | ------------------------------------- |
| TASK-002 | Parity matrix and contract freeze        | `TASK-002-migration-parity-matrix.md` |
| TASK-003 | Auth JWT + cookie transport + `/v1/auth` | `TASK-003-auth-v1-parity.md`          |
| TASK-004 | Users / profile / password restore       | `TASK-004-users-profile-v1.md`        |
| TASK-005 | Cities + seed                            | `TASK-005-cities-seed.md`             |
| TASK-006 | Storage wiring                           | `TASK-006-storage-media-wiring.md`    |
| TASK-007 | Campaigns core                           | `TASK-007-campaigns-core.md`          |
| TASK-008 | Campaign admin / privileges / services   | `TASK-008-campaign-admin.md`          |
| TASK-009 | Workers public API                       | `TASK-009-workers-public-api.md`      |
| TASK-010 | Schedule                                 | `TASK-010-schedule-v1.md`             |
| TASK-011 | Appointments                             | `TASK-011-appointments-v1.md`         |
| TASK-012 | Comments                                 | `TASK-012-comments-v1.md`             |
| TASK-013 | Ranking Cron + Worker                    | `TASK-013-ranking-jobs.md`            |
| TASK-014 | Platform admin                           | `TASK-014-platform-admin-v1.md`       |
| TASK-015 | Notifications + Socket.IO                | `TASK-015-notifications-socketio.md`  |
| TASK-016 | Web Push                                 | `TASK-016-web-push.md`                |
| TASK-017 | Feedback                                 | `TASK-017-feedback-v1.md`             |
| TASK-018 | Fondy payments                           | `TASK-018-payments-fondy.md`          |
| TASK-019 | Public utilities                         | `TASK-019-public-utilities-v1.md`     |
| TASK-020 | Legacy DB ETL                            | `TASK-020-legacy-db-etl.md`           |
| TASK-021 | Staging smoke + cutover                  | `TASK-021-parity-smoke-cutover.md`    |

## Status tracking

Use `docs/agent-tasks/INDEX.md`. Only a human may set specification or plan status to `approved`.
All migration task specifications are currently `proposed`.

## Planning rule (human decisions)

When planning any `TASK-xxx` (`/plan-task`):

1. Ask only decisions that belong to **that task**.
2. Surface specification open questions plus any new in-scope choices found in code.
3. Wait for human answers before writing the implementation plan.
4. Do not invent defaults silently; recommendations are allowed, final choice is human.
