# Agent backlog index

This file provides stable identifiers for sections in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`.
Agents must work on one ID at a time and must always read the full matching source section.

## P0 — runtime and data integrity

| ID | Source section |
|---|---|
| `P0-01` | `1. Зробити idempotency email worker атомарною` |
| `P0-02` | `2. Усунути завершення Outbox lease під час активної обробки batch` |

## P1 — portability and composition

| ID | Source section |
|---|---|
| `P1-01` | `3. Додати typed forRoot / forRootAsync contracts для reusable infrastructure modules` |
| `P1-02` | `4. Розділити env validation за entrypoint і модулем` |
| `P1-03` | `5. Зробити BullMQ registration явною для кожного composition root` |
| `P1-04` | `6. AuthModule повинен створювати лише вибрану strategy` |
| `P1-05` | `7. Прибрати NestJS decorators із Application layer або чесно змінити архітектурний контракт` |
| `P1-06` | `8. Зменшити використання @Global() і зробити provider visibility явною` |

## P2 — configurability, production readiness and documentation

| ID | Source section |
|---|---|
| `P2-01` | `9. Винести Outbox runtime constants у typed configuration` |
| `P2-02` | `10. Виправити неправильний log prefix у Redis startup probe` |
| `P2-03` | `11. Усунути documentation mismatch щодо idempotency` |
| `P2-04` | `12. Усунути documentation mismatch щодо незалежного перенесення модулів` |
| `P2-05` | `13. Уточнити документацію щодо framework independence` |

## Verification backlog

| ID | Source section |
|---|---|
| `V-01` | `14. Виконати чисте встановлення залежностей` |
| `V-02` | `15. Виконати build і typecheck` |
| `V-03` | `16. Виконати lint без врахування суто форматувальних проблем` |
| `V-04` | `17. Перевірити bootstrap кожного entrypoint` |
| `V-05` | `18. Перевірити Docker startup flow` |
| `V-06` | `19. Перевірити migration concurrency` |
| `V-07` | `20. Перевірити graceful shutdown активних BullMQ jobs` |

## Status model

The source backlog remains the statement of work. Plans and reports track execution state.

Recommended lifecycle:

```text
open
  -> plan proposed
  -> plan approved by human
  -> implemented
  -> independently verified
  -> accepted by human
```

Do not edit this index to claim an issue is resolved. Resolution should be recorded in the plan/report history or the project issue tracker.
