# Cursor agent workflow

Цей каталог описує єдиний workflow для review, bugfix і нових задач.

## Компоненти

- `AGENTS.md` — головний repository contract.
- `.cursor/rules/` — автоматичні constraints.
- `.cursor/skills/` — детальні процедури.
- `.cursor/agents/` — спеціалізовані ролі.
- `.cursor/commands/` — короткі entrypoints.
- `docs/agent-backlog/` — confirmed defects.
- `docs/agent-tasks/` — new-task specifications.
- `docs/agent-plans/` — implementation plans.
- `docs/agent-reports/` — evidence та verdicts.

## Команди

### Повне review

```text
/review-starter
```

### Bugfix

```text
/plan-fix P0-01
/implement-fix P0-01
/verify-fix P0-01
```

### Нова задача

```text
/define-task <опис>
/plan-task TASK-001
/implement-task TASK-001
/verify-task TASK-001
```

## Approval gates

### Bugfix

Planner створює `status: proposed`. Лише людина змінює його на `approved`.

### New task

Потрібні два approvals:

1. specification under `docs/agent-tasks/`;
2. implementation plan under `docs/agent-plans/`.

## Незалежна verification

Verifier запускається в новому chat, не змінює production code та повертає:

- `approved`;
- `changes-required`;
- `not-confirmed`.

## Fallback без slash-команд

```text
Read @.cursor/commands/<command>.md and execute it ...
```

Повна інструкція:

```text
README_CURSOR_AGENTS.md
```
