---
task_id: TASK-001
task_type: technical
status: approved
owner: human-approval-required
---

# TASK-001 — Повна документація HTTP API та обов’язковий стандарт для майбутніх задач

## Original request

Створити й додати задачу на опис роботи API: що кожен endpoint приймає, що повертає, додати цей опис усюди та зафіксувати його як обов’язкову вимогу для майбутніх задач.

## Problem or opportunity

Поточний API має реалізовані Auth і Health endpoints, DTO validation та єдиний формат помилок, але не має єдиного машинозчитуваного API-контракту. Частина прикладів розподілена між `README.md` і `EXAMPLES.md`, а `@nestjs/swagger` відсутній у залежностях. Через це frontend, інтегратори й розробники не мають одного достовірного місця, де видно request body, параметри, headers/cookies, успішні відповіді, помилки та вимоги авторизації.

Поточний workflow нових задач також не вимагає явно оновлювати API-документацію для кожного нового або зміненого HTTP endpoint, тому документація може знову відстати від реалізації.

## Goal

Створити повну OpenAPI-документацію для всіх наявних HTTP endpoints, надати зручний Swagger UI і JSON-документ та закріпити підтримку API-контракту як обов’язкову частину визначення, планування, реалізації й перевірки всіх майбутніх задач, що додають або змінюють HTTP API.

## Users and actors

- frontend-розробники, які інтегруються з API;
- зовнішні інтегратори та споживачі starter kit;
- backend-розробники, які додають або змінюють endpoints;
- QA, які перевіряють request/response contracts;
- task analyst, planner, implementer і verifier у Cursor workflow;
- оператори, які керують доступністю Swagger UI у різних середовищах.

## Current system context

- HTTP entrypoint: `apps/api/src/main.ts`.
- Поточні Auth endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me`.
- Поточні Health endpoints: `GET /health`, `GET /health/live`, `GET /health/ready`.
- Request DTO розміщені в `apps/api/src/dto/auth/`.
- Auth responses залежать від `AUTH_DRIVER=jwt|session`: JWT повертає токени, session mode встановлює cookie.
- Помилки нормалізуються `GlobalExceptionFilter` у формат `{ success: false, error: ... }`.
- У `package.json` немає `@nestjs/swagger`.
- `README.md` і `EXAMPLES.md` містять часткові ручні приклади, але вони не є повним контрактом усіх endpoints.

## Functional requirements

- **FR-01:** API повинен генерувати валідний OpenAPI-документ із поточної реалізації NestJS та надавати Swagger UI для інтерактивного перегляду.
- **FR-02:** OpenAPI JSON і Swagger UI повинні мати стабільні, задокументовані URL; доступність у production повинна явно керуватися конфігурацією та бути безпечною за замовчуванням.
- **FR-03:** У документації повинні бути присутні всі наявні Auth і Health endpoints без пропусків.
- **FR-04:** Для кожного endpoint потрібно описати призначення, HTTP method/path, request body, path/query parameters, значущі headers, cookies, validation constraints і чи є кожне поле обов’язковим або опційним.
- **FR-05:** Для кожного endpoint потрібно описати всі очікувані успішні status codes, точну структуру response body та репрезентативний приклад відповіді.
- **FR-06:** Для кожного endpoint потрібно описати очікувані помилки, їх HTTP status codes і спільний error envelope, не розкриваючи внутрішні або секретні дані.
- **FR-07:** Документація Auth endpoints повинна явно відображати вимоги Bearer JWT та session cookie, відмінності response/cookie behavior між `AUTH_DRIVER=jwt` і `AUTH_DRIVER=session`, refresh-token rotation і можливість logout без чинного access token.
- **FR-08:** DTO та response schemas мають бути описані типізовано й повторно використовувати спільні schema components там, де контракт однаковий; документація не повинна покладатися лише на довільний текст або нетипізовані приклади.
- **FR-09:** `README.md` і `EXAMPLES.md` потрібно синхронізувати з canonical OpenAPI-документацією: додати URL, спосіб увімкнення, призначення та правило оновлення без дублювання суперечливих контрактів.
- **FR-10:** Інструкція «як додати новий HTTP endpoint» і checklist нової feature повинні вимагати документування input, output, status codes, errors, auth, headers/cookies та перевірку оновленого OpenAPI.
- **FR-11:** Repository workflow для нових задач повинен явно вимагати, щоб будь-яка задача, яка додає або змінює HTTP endpoint, містила API-contract requirements і acceptance criteria у specification, точні кроки оновлення документації у plan, фактичне оновлення документації в implementation та незалежну перевірку відповідності документації реальній поведінці.
- **FR-12:** Вимога FR-11 повинна бути закріплена в постійних repository instructions/rules, task template та відповідних task-definition, task-planning, task-implementation і task-verification workflow artifacts, щоб вона застосовувалась до всіх майбутніх API-задач.
- **FR-13:** Повинен існувати автоматизований тест або еквівалентний repository check, який будує OpenAPI document, підтверджує наявність усіх поточних маршрутів та основних request/response schemas і виявляє очевидний drift або неповну документацію.

## Non-functional requirements

- **NFR-01:** Документація має відповідати OpenAPI 3.x і бути придатною для Swagger UI та генерації типізованих клієнтів.
- **NFR-02:** Увімкнення документації не повинно змінювати бізнес-поведінку, validation, auth, rate limiting або response contracts наявних endpoints.
- **NFR-03:** Swagger/OpenAPI bootstrap повинен залишатися лише в API entrypoint і не впливати на Worker, Cron або Migrations.
- **NFR-04:** Документація не повинна містити реальні credentials, tokens, session IDs, production hosts або інші секрети.
- **NFR-05:** Production за замовчуванням не повинен публічно відкривати інтерактивну документацію без явного operator opt-in.
- **NFR-06:** Нові типи й decorators не повинні створювати залежність Domain, Application або Contracts від NestJS/Swagger; HTTP documentation залишається в API/interface layer.
- **NFR-07:** Додані dependency та конфігурація повинні використовувати версії, сумісні з поточним NestJS 11 і Node.js policy репозиторію.

## Public API and interface impact

Наявні бізнесові endpoint paths і response behavior залишаються backward-compatible. Додаються окремі documentation endpoints для Swagger UI та OpenAPI JSON. Усі поточні Auth і Health contracts стають явно описаними.

Будь-який майбутній HTTP endpoint або зміна його request/response contract повинні в тій самій задачі оновлювати canonical OpenAPI-документацію.

## Data model and migration impact

Змін схеми PostgreSQL і міграцій не потрібно.

## Events, queues and background processing

Змін domain events, Outbox, BullMQ queues, Worker processors або Cron schedules не потрібно.

## Security and authorization

- OpenAPI має описувати Bearer auth і session-cookie auth як окремі security schemes.
- Документація захищених маршрутів повинна показувати правильні security requirements.
- Приклади використовують лише фіктивні значення.
- Production exposure Swagger UI/OpenAPI JSON має бути явно контрольованим і вимкненим за безпечним default.
- Документація помилок не повинна обіцяти або показувати stack traces чи внутрішні exception details.

## Entrypoints and deployment impact

Змінюється лише API entrypoint. Worker, Cron і Migrations залишаються незалежними та не піднімають documentation routes. Deployment documentation повинна пояснити конфігурацію доступності Swagger/OpenAPI.

## Observability and operations

- Старт API повинен чітко повідомляти про ввімкнену документацію та її URL без виведення секретів.
- Вимкнена документація не повинна створювати помилки або зайвий runtime dependency graph.
- Health endpoints залишаються придатними для probes незалежно від стану Swagger UI.

## Compatibility requirements

- Не змінювати paths, methods, validation rules, auth semantics або envelopes наявних endpoints лише заради документації.
- Зберегти підтримку обох auth drivers.
- Зберегти незалежний bootstrap усіх чотирьох entrypoints.
- Ручні приклади в документації не повинні суперечити generated OpenAPI contract.

## Dependencies

- Очікується додавання офіційної NestJS OpenAPI інтеграції (`@nestjs/swagger`) та лише необхідних сумісних peer/runtime dependencies.
- Зміна `package-lock.json` дозволена тільки як прямий наслідок затвердженої dependency change.

## Assumptions

- Canonical форматом API-контракту буде OpenAPI 3.x, а Swagger UI — його інтерактивним представленням.
- «Додати опис усюди» означає покрити всі поточні HTTP endpoints, синхронізувати основну користувацьку документацію та оновити всі етапи task workflow, де API-вимога може бути втрачена.
- Документація описує фактичну поточну поведінку; ця задача не змінює бізнес-контракти для їх спрощення.
- Точні URL documentation endpoints і назва env/config flag визначаються в implementation plan, але мають бути стабільними та задокументованими.

## Out of scope

- Додавання нових бізнесових endpoints.
- Зміна Auth або Health behavior.
- Генерація та публікація SDK/client package.
- Публічний hosting окремого developer portal.
- Документування Worker/Cron внутрішніх job contracts як HTTP API.
- Зміни бази даних, черг, Outbox або email flow.

## Acceptance criteria

- **AC-01:** Swagger UI та OpenAPI JSON успішно генеруються під час API bootstrap за дозволеної конфігурації, а production default не відкриває їх без явного opt-in.
- **AC-02:** OpenAPI document містить усі 8 поточних Auth і Health routes з правильними methods і paths.
- **AC-03:** Кожен поточний route має описані inputs, validation/requiredness, успішні responses, очікувані errors, status codes і security requirements.
- **AC-04:** JWT/session відмінності, Bearer scheme, session cookie, refresh rotation і logout behavior однозначно відображені в документації.
- **AC-05:** Спільні success/error schemas і domain-specific response schemas є типізованими, повторно використовуваними та відповідають фактичним response bodies.
- **AC-06:** `README.md`, `EXAMPLES.md` та checklist додавання HTTP endpoint посилаються на canonical OpenAPI docs і містять обов’язкове правило оновлення API-контракту.
- **AC-07:** Постійні repository rules/instructions, task template і всі чотири new-task workflow stages явно вимагають API contract documentation для кожної майбутньої задачі, що додає або змінює HTTP endpoint.
- **AC-08:** Автоматизований check падає, якщо поточний documented route зникає з OpenAPI або ключовий request/response schema відсутній.
- **AC-09:** `npm run build:api`, `npm run lint`, релевантні тести та API bootstrap завершуються успішно; Worker, Cron і Migrations не отримують Swagger runtime composition.
- **AC-10:** Жоден наявний API path, auth rule, validation rule або бізнесовий response contract не змінено без окремо затвердженої вимоги.

## Verification strategy

- Згенерувати OpenAPI document у тесті та перевірити список paths/methods, security schemes, request schemas і response schemas.
- Виконати релевантні unit/module тести для API documentation bootstrap.
- Виконати `npm run build:api`, `npm run lint` і `npm run test:all`.
- Запустити API з documentation enabled у безпечному локальному середовищі та перевірити Swagger UI й JSON endpoint.
- Перевірити disabled/default production configuration без публічних documentation routes.
- Порівняти OpenAPI schemas з DTO, controller return values, auth driver behavior і `GlobalExceptionFilter`.
- Перевірити diff усіх workflow artifacts та підтвердити, що майбутня API-задача не може пройти specification, planning, implementation і verification checklist без оновлення контракту.

## Rollout and rollback

Rollout не потребує міграцій. Спочатку dependency/configuration і generated contract перевіряються локально, потім документація вмикається лише у дозволених середовищах. Rollback полягає у вимкненні documentation feature/configuration без зміни бізнесових routes; видалення dependency або документованих schemas потребує окремого revert.

## Open questions requiring human decision

Немає блокуючих питань на рівні specification. Точні documentation URLs і назва config flag мають бути запропоновані в implementation plan та схвалені людиною разом із планом.
