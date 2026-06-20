# Cursor Agent Architecture

У репозиторії використовується єдина Cursor agent architecture для повного review, bugfix workflow і виконання нових задач.

## Компоненти

```text
AGENTS.md                       — repository-wide правила
.cursor/rules/                  — автоматичні архітектурні та safety constraints
.cursor/skills/                 — процедури review/plan/implement/verify
.cursor/agents/                 — вузькі ролі агентів
.cursor/commands/               — slash-команди
docs/agent-backlog/             — confirmed defects
docs/agent-tasks/               — specifications нових задач
docs/agent-plans/               — proposed/approved plans
docs/agent-reports/             — implementation і verification evidence
docs/agent-workflow/            — workflow docs та review rubric
```

## Bugfix

```text
/plan-fix P0-01
```

Після ручного затвердження plan:

```text
/implement-fix P0-01
```

У новому chat:

```text
/verify-fix P0-01
```

## Нова задача

```text
/define-task

<опис задачі та вимоги>
```

Після ручного затвердження specification:

```text
/plan-task TASK-001
```

Після ручного затвердження plan:

```text
/implement-task TASK-001
```

У новому chat:

```text
/verify-task TASK-001
```

## Повне review

```text
/review-starter
```

Повна документація знаходиться у:

```text
README_CURSOR_AGENTS.md
docs/agent-workflow/README.md
```
