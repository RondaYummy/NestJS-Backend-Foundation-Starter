# Cursor Agents — complete workflow for NestJS Starter Kit

Цей пакет додає до репозиторію єдину агентну систему для:

- повного архітектурного review;
- планування, реалізації та незалежної перевірки багфіксів;
- формалізації, планування, реалізації та перевірки нових задач;
- контролю Onion Architecture, DI, module portability та runtime evidence;
- людського approval перед змінами коду.

Пакет призначений для розпакування в **корінь NestJS Starter Kit**.

---

## 1. Що входить у пакет

```text
AGENTS.md
.cursorignore

.cursor/
├── rules/
│   ├── 00-project-context.mdc
│   ├── 10-onion-architecture.mdc
│   ├── 20-module-portability.mdc
│   ├── 30-runtime-and-verification.mdc
│   ├── 40-agent-safety.mdc
│   └── 50-new-task-delivery.mdc
│
├── skills/
│   ├── nestjs-starter-review/SKILL.md
│   ├── bugfix-planning/SKILL.md
│   ├── bugfix-implementation/SKILL.md
│   ├── change-verification/SKILL.md
│   ├── task-definition/SKILL.md
│   ├── task-planning/SKILL.md
│   ├── task-implementation/SKILL.md
│   └── task-verification/SKILL.md
│
├── agents/
│   ├── architecture-reviewer.md
│   ├── bugfix-planner.md
│   ├── bugfix-implementer.md
│   ├── independent-verifier.md
│   ├── task-analyst.md
│   ├── task-planner.md
│   ├── task-implementer.md
│   └── task-verifier.md
│
└── commands/
    ├── review-starter.md
    ├── plan-fix.md
    ├── implement-fix.md
    ├── verify-fix.md
    ├── define-task.md
    ├── plan-task.md
    ├── implement-task.md
    └── verify-task.md

docs/
├── agent-backlog/
│   ├── INDEX.md
│   └── NESTJS_STARTER_KIT_REQUIRED_FIXES.md
├── agent-tasks/
│   ├── INDEX.md
│   ├── README.md
│   └── TEMPLATE.md
├── agent-plans/
│   └── README.md
├── agent-reports/
│   └── README.md
└── agent-workflow/
    ├── README.md
    └── NESTJS_STARTER_KIT_REVIEW_PROMPT.md

README_APPEND_CURSOR_AGENTS.md
README_CURSOR_AGENTS.md
```

---

## 2. Роль кожного рівня

### `AGENTS.md`

Головний repository-wide контракт. Містить:

- призначення starter kit;
- реальні API, Worker, Cron і Migrations entrypoints;
- межі Domain/Application/Contracts/Infrastructure;
- обов’язкові команди перевірки;
- правила роботи з Git, Docker, secrets і migrations;
- bugfix workflow;
- new-task workflow;
- Definition of Done.

Його не треба запускати вручну.

### `.cursor/rules/`

Короткі постійні або path-scoped обмеження:

- dependency direction;
- module portability;
- runtime verification;
- safety;
- approval rules для нових задач.

Rules застосовуються автоматично, коли Cursor працює з відповідними файлами.

### `.cursor/skills/`

Повні процедури виконання роботи. Skill описує:

- порядок аналізу;
- обов’язкові джерела;
- guardrails;
- output-файл;
- acceptance та verification logic.

### `.cursor/agents/`

Вузькі ролі:

- reviewer тільки аналізує;
- planner тільки планує;
- implementer змінює код за approved plan;
- verifier перевіряє diff і не виправляє код.

### `.cursor/commands/`

Короткі entrypoints, щоб не копіювати великі prompts:

```text
/review-starter
/plan-fix P0-01
/implement-fix P0-01
/verify-fix P0-01

/define-task <опис>
/plan-task TASK-001
/implement-task TASK-001
/verify-task TASK-001
```

### `docs/agent-*`

- `agent-backlog` — source of truth для confirmed defects;
- `agent-tasks` — specifications для нових задач;
- `agent-plans` — proposed/approved implementation plans;
- `agent-reports` — review, implementation та verification evidence;
- `agent-workflow` — правила та rubric повного review.

---

## 3. Встановлення

1. Зробіть backup поточної `.cursor` конфігурації, якщо вона вже є.
2. Розпакуйте distributable ZIP у корінь репозиторію, де знаходиться `package.json`. Maintainer ZIP має збиратися через `npm run release:archive` (або `npm run release:check`), **не** через стискання робочої директорії — інакше в пакет потрапляють `.env` і `.git/`.
3. Перевірте diff:

```bash
git status
git diff --stat
git diff
```

4. Якщо у вас вже є власний `AGENTS.md`, об’єднайте його вручну з файлом із пакета.
5. Не замінюйте кореневий `README.md` автоматично. Додайте до нього вміст:

```text
README_APPEND_CURSOR_AGENTS.md
```

6. Перезапустіть Cursor і відкрийте саме корінь репозиторію.
7. У новому Agent chat введіть `/` і перевірте наявність команд.

---

## 4. Bugfix workflow

Використовуйте для підтверджених проблем із:

```text
docs/agent-backlog/
```

ID мають формат:

```text
P0-01
P1-03
P2-02
```

### Крок 1 — план

```text
/plan-fix P0-01
```

Planner:

- перевіряє, що проблема ще існує;
- читає всі affected contracts, providers і consumers;
- не змінює production code;
- створює:

```text
docs/agent-plans/P0-01-<slug>.md
```

Статус:

```yaml
status: proposed
```

### Крок 2 — людське затвердження

Перевірте план і вручну змініть:

```yaml
status: proposed
```

на:

```yaml
status: approved
```

### Крок 3 — реалізація

```text
/implement-fix P0-01
```

Результат:

- production-code diff;
- targeted/full checks;
- `docs/agent-reports/P0-01-implementation.md`.

Якщо змінився тільки report, а план вимагав production-код — задача не реалізована.

### Крок 4 — незалежна перевірка

Відкрийте новий chat:

```text
/verify-fix P0-01
```

Результат:

```text
docs/agent-reports/P0-01-verification.md
```

Вердикт:

- `approved`;
- `changes-required`;
- `not-confirmed`.

---

## 5. New-task workflow

Використовуйте для:

- нових фіч;
- нових модулів;
- інтеграцій;
- технічних покращень;
- planned refactoring;
- infrastructure/documentation задач.

ID мають формат:

```text
TASK-001
TASK-002
```

### Крок 1 — specification

```text
/define-task

Додати password reset через email.
Вимоги:
- одноразовий токен;
- TTL 15 хвилин;
- лист через існуючу queue;
- не розкривати існування email;
- відкликати активні сесії після зміни пароля.
```

Analyst створить:

```text
docs/agent-tasks/TASK-001-password-reset.md
```

та оновить:

```text
docs/agent-tasks/INDEX.md
```

Specification має статус:

```yaml
status: proposed
```

### Крок 2 — затвердження specification

Перевірте:

- functional requirements;
- non-functional requirements;
- API/data/security impact;
- assumptions;
- out of scope;
- acceptance criteria;
- open human decisions.

Потім вручну змініть status на `approved`.

### Крок 3 — implementation plan

```text
/plan-task TASK-001
```

Planner створить:

```text
docs/agent-plans/TASK-001-password-reset.md
```

План теж починається зі статусу `proposed`.

### Крок 4 — затвердження плану

Перевірте:

- exact paths і symbols;
- contracts/DI;
- migrations;
- transactions/Outbox/idempotency;
- entrypoint composition;
- rollout/rollback;
- mapping кожного `AC-*` до verification.

Після цього вручну поставте `status: approved`.

### Крок 5 — реалізація

```text
/implement-task TASK-001
```

Результат:

```text
docs/agent-reports/TASK-001-implementation.md
```

### Крок 6 — verification

У новому chat:

```text
/verify-task TASK-001
```

Результат:

```text
docs/agent-reports/TASK-001-verification.md
```

---

## 6. Full project review

```text
/review-starter
```

Reviewer працює read-only і виконує:

1. documentation baseline;
2. inventory;
3. DI/dependency mapping;
4. build/lint/runtime checks;
5. evidence-based findings;
6. report у `docs/agent-reports/`.

---

## 7. Якщо slash-команди не відображаються

Використовуйте command-файл напряму:

```text
Read @.cursor/commands/plan-fix.md and execute it for P0-01.
```

```text
Read @.cursor/commands/define-task.md and execute it for this request:

<опис задачі>
```

```text
Read @.cursor/commands/plan-task.md and execute it for TASK-001.
```

```text
Read @.cursor/commands/implement-task.md and execute it for TASK-001.
```

```text
Read @.cursor/commands/verify-task.md and execute it for TASK-001.
```

---

## 8. Git workflow

Рекомендація:

```text
1 issue/task = 1 branch = 1 plan = 1 implementation report = 1 verification report
```

Bugfix:

```bash
git switch -c fix/P0-01-atomic-email-idempotency
```

Feature:

```bash
git switch -c feature/TASK-001-password-reset
```

Агенти не повинні самостійно commit/push/switch branch, якщо ви явно цього не попросили.

---

## 9. Approval boundaries

### Bugfix

```text
confirmed issue
  -> proposed plan
  -> human approves plan
  -> implementation
  -> independent verification
  -> human acceptance
```

### New task

```text
rough request
  -> proposed specification
  -> human approves specification
  -> proposed plan
  -> human approves plan
  -> implementation
  -> independent verification
  -> human acceptance
```

Агент не має права сам змінювати `proposed` на `approved`.

---

## 10. Основні правила

- Не змішуйте кілька ID в одному diff.
- Не додавайте сторонній баг у нову feature-задачу мовчки.
- Не дозволяйте verifier виправляти код.
- Не приймайте implementation report без перевірки реального `git diff`.
- Не вважайте build доказом функціональної коректності.
- Не дозволяйте обхід помилок через `any`, `@ts-ignore`, вимкнення rules або видалення validation.
- Не запускайте destructive migrations, `docker compose down -v`, force push або production commands без явного рішення людини.
