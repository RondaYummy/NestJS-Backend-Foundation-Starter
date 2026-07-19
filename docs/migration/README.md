# Migration parity catalog (TASK-002)

Living catalog of all legacy `OLD_BACKEND` client-observable contracts and their mapping to migration tasks `TASK-003…021`.

Produced by **TASK-002** (`docs/agent-tasks/TASK-002-migration-parity-matrix.md`). Updated as later migration slices land or discover gaps.

## Source of truth rule

**`HTTP_PARITY_MATRIX.md` is the contract source of truth for "same as OLD" HTTP behavior.**

Unless a matrix row carries a **D6-break** flag (see `D6_BREAKS.md`), later task implementers and verifiers must preserve the method, path, auth mode, request fields and success shape recorded in the matrix. Rows flagged D6 are intentionally **not** parity contracts; the corrected behavior in `D6_BREAKS.md` wins.

Implementers of each `TASK-xxx` should re-confirm their owned rows against `OLD_BACKEND` source before building (transcription errors in a 67-row matrix are possible; the matrix is a catalog, not a substitute for reading the legacy controller).

## Catalog files

| File | Contents |
| --- | --- |
| [`HTTP_PARITY_MATRIX.md`](HTTP_PARITY_MATRIX.md) | All 67 legacy HTTP routes across 12 controllers: method, path, auth, key request fields, success shape, known error behavior, TASK owner, D6 flag. Includes the legacy-observed auth cookie/header transport (FR-06). |
| [`SIDE_EFFECTS.md`](SIDE_EFFECTS.md) | Non-HTTP contracts: Socket.IO events and handshake auth, cron schedules, Web Push flow, mail triggers, S3 upload call sites, Fondy as-is status. |
| [`ENTITIES_ETL.md`](ENTITIES_ETL.md) | Legacy TypeORM entity/table inventory (11 tables) with JSONB and array-column notes feeding the TASK-020 ETL. |
| [`D6_BREAKS.md`](D6_BREAKS.md) | Explicit list of intentional security/correctness breaks (D6): legacy behavior, corrected target behavior, owning task. |

## Locked program decisions

The migration program decisions **D1–D6** (compatibility layer, auth model, Drizzle+ETL, Socket.IO hosting, migrate-everything-as-is, fix known defects) are defined in [`../agent-tasks/MIGRATION_PROGRAM.md`](../agent-tasks/MIGRATION_PROGRAM.md) and are not duplicated here.

## Deferred items

- **Target cookie names for JWT transport (D2/FR-06):** this catalog records only the *legacy-observed* cookie names (`auth-cookie`, `refresh-cookie`). Freezing the target names is explicitly deferred to `TASK-003` approval.
