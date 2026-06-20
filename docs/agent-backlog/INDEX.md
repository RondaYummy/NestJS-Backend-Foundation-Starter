# Agent backlog index

> **Synchronized:** 20 June 2026  
> **Source of truth:** `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md`  
> **Baseline:** `NestJS-Backend-Foundation-Starter(45).zip`

Agents must work on exactly one ID and read the complete matching section before planning.

## P1 — High

| ID      | Source section                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------ |
| `P1-01` | `P1-01. Закрити path traversal у LocalStorageAdapter`                                            |
| `P1-02` | `P1-02. Додати error boundary та overlap guard для Cron tick`                                    |
| `P1-03` | `P1-03. Посилити production policy для JWT secrets`                                              |
| `P1-04` | `P1-04. Зробити infrastructure modules незалежно конфігурованими й явно скомпонованими`          |
| `P1-05` | `P1-05. Прибрати NestJS DI decorators з Application або офіційно змінити архітектурний контракт` |

## P2 — Medium

| ID      | Source section                                                                        |
| ------- | ------------------------------------------------------------------------------------- |
| `P2-01` | `P2-01. Серіалізувати паралельні PostgreSQL migrations`                               |
| `P2-02` | `P2-02. Узгодити QueueJobRegistry, QUEUES та BullMQ registrations`                    |
| `P2-03` | `P2-03. Реалізувати справжній forgetByPattern()`                                      |
| `P2-04` | `P2-04. Не reclaim-ити Outbox event, поки timeouted handler продовжує side effect`    |
| `P2-05` | `P2-05. Додати bounded deadlines до readiness checks`                                 |
| `P2-06` | `P2-06. Не авторизовувати користувача лише за stale token/session claims`             |
| `P2-07` | `P2-07. Обробляти complete() === false після email side effect`                       |
| `P2-08` | `P2-08. Прибрати другий process.env configuration path для Outbox Worker concurrency` |
| `P2-09` | `P2-09. Усунути high advisories у production dependency graph`                        |
| `P2-10` | `P2-10. Не включати .env і .git у release archive`                                    |
| `P2-11` | `P2-11. Відновити non-formatting lint gate`                                           |

## P3 — Low

| ID      | Source section                                                                         |
| ------- | -------------------------------------------------------------------------------------- |
| `P3-01` | `P3-01. Узгодити Node engine range з dependency requirements`                          |
| `P3-02` | `P3-02. Синхронізувати README з фактичними entrypoint, features та EventBus semantics` |
| `P3-03` | `P3-03. Виправити .env.example і component-specific startup logging`                   |

## Verification

| ID     | Scope                                    |
| ------ | ---------------------------------------- |
| `V-01` | Clean install/build/typecheck/lint/audit |
| `V-02` | Four entrypoint bootstrap                |
| `V-03` | LocalStorage traversal                   |
| `V-04` | Cron failure/overlap                     |
| `V-05` | JWT secret policy                        |
| `V-06` | Parallel migrations                      |
| `V-07` | Queue registry parity                    |
| `V-08` | Pattern cache invalidation               |
| `V-09` | Outbox timeout race                      |
| `V-10` | Health deadlines                         |
| `V-11` | Auth revocation/freshness                |
| `V-12` | Email ownership loss                     |
| `V-13` | Docker/release artifact                  |
| `V-14` | Unit suite timeout                       |
| `V-15` | BullMQ graceful shutdown                 |

## Resolution lifecycle

```text
open
  -> plan proposed
  -> plan approved by human
  -> implemented
  -> independently verified
  -> accepted by human
```

Do not edit this index to claim resolution. Store evidence in plan and implementation/verification reports.
