# Bugfix backlog index

| Issue ID | Severity | Classification           | Title                                                                 |
| -------- | -------- | ------------------------ | --------------------------------------------------------------------- |
| `P2-16`  | Medium   | Confirmed defect         | Fix CronModule ioredis mock so `test:module` passes with BullMQ       |
| `P2-17`  | Medium   | Confirmed defect         | Fail-closed or explicit-skip when integration tests lack PostgreSQL   |
| `P2-18`  | Medium   | Confirmed defect         | Align Dockerfile Node major with `.nvmrc` / CI                        |
| `P2-19`  | Medium   | Architectural risk       | Register JwtModule in `AuthModule.forRootAsync` only for JWT driver   |
| `P2-20`  | Medium   | Architectural risk       | Add configurable BullMQ key prefix for Redis isolation                |
| `P2-21`  | Medium   | Architectural risk       | Require JWT secrets in env schema only when `AUTH_DRIVER=jwt`         |
| `P2-22`  | Medium   | Architectural risk       | Document DomainEventRouter multi-handler at-least-once semantics      |
| `P2-23`  | Medium   | Architectural risk       | Add CI workflow for build, lint, unit and module gates                |
| `P2-24`  | Medium   | Documentation mismatch   | Align `EXAMPLES.md` use-case DI with composition-root pattern         |
| `P2-25`  | Medium   | Documentation mismatch   | Correct MODULES outbox BullMQ `jobId` description                     |
| `P3-05`  | Low      | Confirmed defect         | Map missing `Idempotency-Key` to HTTP 400 instead of 409              |
| `P3-06`  | Low      | Architectural risk       | Stop making `LoggerModule` globally registered by default             |
| `P3-07`  | Low      | Architectural risk       | Harden `OutboxProcessorModule.forRoot` against empty connection imports |
| `P3-08`  | Low      | Documentation mismatch   | Clarify Cache/Storage as optional until wired in entrypoints          |
| `P3-09`  | Low      | Likely defect            | Fix integration-test open-handle leak / Jest force-exit               |
| `P3-10`  | Low      | Architectural risk       | Map `AuthGuard` failures through AppError envelope                    |
| `P3-11`  | Low      | Documentation mismatch   | Clarify Compose `db:migrate` vs `db:migrate:prod` advisory lock       |

## Rules

- Add only defects confirmed against the current branch (or explicitly classified Likely / Architectural risk / Documentation mismatch with code evidence).
- Use a stable, previously unused P-level ID.
- Retired IDs (fixed and removed): `P1-01` … `P1-07`, `P2-01` … `P2-15`, `P3-01` … `P3-04`.
- Next unused IDs after this batch: High `P1-08`, Medium `P2-26`, Low `P3-12` (also avoid reusing any prior `P0-xx` IDs from git history).
- Keep the full issue definition in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`.
- Work on one issue at a time.
- Do not mark an issue resolved without implementation and independent-verification evidence.
- Source baseline: `docs/agent-reports/full-review-2026-08-02.md`.
