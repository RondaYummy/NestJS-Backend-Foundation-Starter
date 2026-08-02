# Agent plans index

This index lists implementation plans under `docs/agent-plans/`.

| ID | Title | Status | Plan |
| --- | --- | --- | --- |
| `P2-16` | Fix CronModule ioredis mock so `test:module` passes with BullMQ | proposed | [P2-16-cron-ioredis-mock-bullmq-module-spec.md](./P2-16-cron-ioredis-mock-bullmq-module-spec.md) |
| `P2-17` | Fail-closed or explicit-skip when integration tests lack PostgreSQL | proposed | [P2-17-fail-closed-integration-tests-without-postgres.md](./P2-17-fail-closed-integration-tests-without-postgres.md) |
| `P2-18` | Align Dockerfile Node major with `.nvmrc` / CI | proposed | [P2-18-align-dockerfile-node-major.md](./P2-18-align-dockerfile-node-major.md) |
| `P2-19` | Register JwtModule in `AuthModule.forRootAsync` only for JWT driver | proposed | [P2-19-auth-async-jwtmodule-driver-isolation.md](./P2-19-auth-async-jwtmodule-driver-isolation.md) |
| `P2-20` | Add configurable BullMQ key prefix for Redis isolation | proposed | [P2-20-configurable-bullmq-key-prefix.md](./P2-20-configurable-bullmq-key-prefix.md) |
| `P2-21` | Require JWT secrets in env schema only when `AUTH_DRIVER=jwt` | proposed | [P2-21-jwt-secrets-required-only-for-jwt-driver.md](./P2-21-jwt-secrets-required-only-for-jwt-driver.md) |
| `P2-22` | Document DomainEventRouter multi-handler at-least-once semantics | proposed | [P2-22-domain-event-router-multi-handler-semantics.md](./P2-22-domain-event-router-multi-handler-semantics.md) |
| `P2-25` | Correct MODULES outbox BullMQ `jobId` description | proposed | [P2-25-correct-modules-outbox-bullmq-jobid-description.md](./P2-25-correct-modules-outbox-bullmq-jobid-description.md) |
| `P2-23` | Add CI workflow for build, lint, unit and module gates | proposed | [P2-23-ci-workflow-build-lint-unit-module.md](./P2-23-ci-workflow-build-lint-unit-module.md) |
| `P2-24` | Align `EXAMPLES.md` use-case DI with composition-root pattern | proposed | [P2-24-align-examples-usecase-di-composition-root.md](./P2-24-align-examples-usecase-di-composition-root.md) |
| `P3-05` | Map missing `Idempotency-Key` to HTTP 400 instead of 409 | proposed | [P3-05-map-missing-idempotency-key-to-400.md](./P3-05-map-missing-idempotency-key-to-400.md) |
| `P3-06` | Stop making `LoggerModule` globally registered by default | proposed | [P3-06-logger-module-non-global-default.md](./P3-06-logger-module-non-global-default.md) |
| `P3-07` | Harden `OutboxProcessorModule.forRoot` against empty connection imports | proposed | [P3-07-harden-outbox-processor-forroot-imports.md](./P3-07-harden-outbox-processor-forroot-imports.md) |
| `P3-08` | Clarify Cache/Storage as optional until wired in entrypoints | proposed | [P3-08-clarify-cache-storage-optional-until-wired.md](./P3-08-clarify-cache-storage-optional-until-wired.md) |
| `P3-10` | Map `AuthGuard` failures through AppError envelope | proposed | [P3-10-map-authguard-failures-apperror-envelope.md](./P3-10-map-authguard-failures-apperror-envelope.md) |
| `P3-09` | Fix integration-test open-handle leak / Jest force-exit | proposed | [P3-09-fix-integration-test-open-handle-force-exit.md](./P3-09-fix-integration-test-open-handle-force-exit.md) |
| `P3-11` | Clarify Compose `db:migrate` vs `db:migrate:prod` advisory lock | proposed | [P3-11-clarify-compose-db-migrate-vs-prod-advisory-lock.md](./P3-11-clarify-compose-db-migrate-vs-prod-advisory-lock.md) |

## Rules

- Plan filenames follow `<id>-<short-slug>.md` (see `README.md`).
- New-task plans use frontmatter `task_id`, `specification`, `status`, `owner`.
- Only a human changes plan status from `proposed` to `approved`.
- Do not overwrite an existing plan file for a different slug of the same ID; use a distinct slug.
- Bugfix plans (`P0-xx`, …) may also live here; keep them separate from `TASK-xxx` rows when present.
- Completed plans are removed from this index after verification; IDs are never reused.
