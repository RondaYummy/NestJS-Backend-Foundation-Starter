# Промпт для детального рев’ю NestJS Starter Kit

## Роль

Ти виступаєш як **Senior/Lead NestJS Backend Architect** і проводиш доказове архітектурне та технічне рев’ю прикріпленого архіву з NestJS-проєктом.

Це не огляд за назвами файлів. Ти повинен перевіряти повний dependency flow, реєстрацію провайдерів, runtime composition, конфігурацію та фактичну працездатність доступними в середовищі способами.

## Контекст проєкту

Це переносний NestJS Starter Kit, який має бути фундаментом для різних проєктів.

Його модулі повинні:

- переноситися між проєктами незалежно;
- підключатися лише за потреби;
- конфігуруватися без зміни внутрішньої реалізації;
- працювати в API, Worker, Cron і CLI entrypoint;
- розширюватися без порушення меж інших модулів;
- не залежати від конкретної бізнес-логіки проєкту.

---

## Обов’язковий порядок роботи

Не переходь одразу до написання зауважень.

### Етап 1. Документація

Перед аналізом коду повністю прочитай:

1. `README.md`
2. `MODULES_OVERVIEW_NON_TECH.md`
3. `EXAMPLES.md`

Після цього сформуй внутрішній перелік заявлених вимог і використовуй його як baseline для перевірки реалізації.

Якщо одного з файлів немає або він не читається, явно зафіксуй це у фінальному звіті.

### Етап 2. Інвентаризація

До формування висновків перевір:

- `package.json`;
- lock-файл і package manager;
- `tsconfig*`;
- Nest CLI configuration;
- Dockerfile і `docker-compose*`;
- environment examples;
- усі entrypoint;
- усі root modules;
- migrations і schema;
- структуру Domain/Application/Infrastructure/Interface;
- dynamic modules і injection tokens.

Склади внутрішню карту:

```text
entrypoint
  -> root module
    -> imported modules
      -> providers
        -> ports/tokens
          -> concrete implementations
```

Не публікуй повний переказ цієї карти, але використовуй її для перевірки DI та dependency direction.

### Етап 3. Runtime-перевірка

Якщо середовище дозволяє, виконай:

1. встановлення залежностей відповідним package manager;
2. build;
3. TypeScript typecheck;
4. lint, але не враховуй Prettier та суто форматувальні помилки;
5. запуск або bootstrap-перевірку кожного заявленого entrypoint;
6. перевірку Docker startup flow;
7. перевірку команд міграцій.

Не запускай destructive-команди над зовнішніми сервісами або production-ресурсами.

У фінальному звіті наведи:

```text
Команда:
Результат:
Висновок:
```

Якщо запуск неможливий через відсутню інфраструктуру, відокрем:

- помилку проєкту;
- очікувану помилку через відсутній PostgreSQL/Redis/SMTP;
- частину, яку неможливо підтвердити.

### Етап 4. Аналіз коду

Тільки після документації, інвентаризації та доступної runtime-перевірки переходь до формування зауважень.

---

## Правила доказовості

Не створюй проблему лише через підозрілу назву або структуру каталогу.

Кожне зауваження повинно мати хоча б один доказ:

- точний файл і symbol;
- конкретний import/dependency chain;
- конкретна реєстрація provider/token;
- конкретний фрагмент конфігурації;
- результат build/start/typecheck;
- суперечність документації та коду.

Класифікуй кожне зауваження як:

- **Confirmed defect** — підтверджено кодом або запуском;
- **Likely defect** — код вказує на проблему, але runtime-підтвердження неможливе;
- **Architectural risk** — код може працювати, але порушує вимоги starter kit;
- **Documentation mismatch** — документація не відповідає реалізації.

Не подавай `Architectural risk` як доведену runtime-помилку.

---

## Що не враховувати в оцінці

Не знижуй оцінку через:

- відсутність unit/integration/e2e тестів;
- Prettier;
- форматування;
- сам факт використання спільного `InfrastructureModule`.

`InfrastructureModule` можна критикувати лише тоді, коли він:

- створює неправильний dependency direction;
- приховує обов’язкові залежності;
- робить модуль непереносним;
- змушує entrypoint підключати непотрібну інфраструктуру;
- призводить до некоректної DI-реєстрації.

Lint-помилки враховуй лише тоді, коли вони вказують на реальний type/runtime/architecture defect, а не форматування.

---

## Області перевірки

### 1. Модульність і переносимість

Перевір:

- незалежне перенесення кожного інфраструктурного модуля;
- явність зовнішніх залежностей;
- `forRoot`, `forRootAsync` або еквівалентний typed configuration contract;
- можливість використання з `ConfigService`;
- exports providers і tokens;
- відсутність конкретної бізнес-логіки;
- відсутність необхідності редагувати внутрішній код модуля;
- відсутність прихованої залежності від global modules.

### 2. Архітектурні межі

Перевір:

- Domain не залежить від NestJS, ORM, Redis, BullMQ, HTTP;
- Application залежить від портів, а не concrete infrastructure;
- Infrastructure реалізує порти;
- Interface/Presentation перетворює input/output і викликає use cases;
- controllers/workers/cron/CLI не містять бізнес-правил;
- залежності спрямовані всередину.

Перевір не лише imports, а також типи параметрів, DTO, exceptions, decorators і return types.

### 3. Dependency Injection

Перевір:

- усі injection tokens;
- imports/providers/exports;
- provider visibility;
- optional/global dependencies;
- circular dependencies;
- дублювання provider instances;
- використання concrete class замість token;
- можливість заміни Redis, Queue, EventBus, Repository, Email та SMS adapters.

Для знайденої DI-проблеми покажи повний ланцюжок:

```text
Consumer
  -> injected token/class
  -> declaring module
  -> exporting module
  -> importing module
  -> composition root
```

### 4. Конфігурація

Перевір:

- typed configuration;
- environment validation;
- sync/async registration;
- defaults;
- invalid/missing values;
- secrets;
- пряме використання `process.env`;
- hardcoded connection names, queue names, TTL, retry policies та provider-specific values.

### 5. PostgreSQL і Drizzle

Перевір:

- pool lifecycle;
- connection initialization;
- shutdown;
- migrations;
- transaction API;
- transaction propagation;
- repository ports;
- відсутність Drizzle types/schema в Domain/Application;
- атомарність use cases;
- атомарність business write + outbox write;
- поведінку міграцій при кількох інстансах.

### 6. Redis

Перевір:

- lifecycle;
- retry/reconnect/error handling;
- startup failure behavior;
- key prefix/namespacing;
- TTL;
- serialization;
- shutdown;
- isolation від Application/Domain;
- можливість заміни adapter.

### 7. BullMQ і Workers

Перевір:

- producer/consumer separation;
- queue registration;
- typed payload;
- retry/backoff;
- idempotency;
- failed jobs;
- stalled jobs;
- concurrency;
- shutdown;
- correlation;
- application use case invocation;
- окремий worker entrypoint;
- відсутність непотрібного HTTP bootstrap.

### 8. Cron

Перевір:

- thin cron handler;
- application use case;
- local overlap protection;
- distributed locking;
- multi-instance behavior;
- окремий cron entrypoint;
- timezone і retry/failure behavior.

### 9. EventBus

Перевір:

- domain events та integration events;
- contracts;
- handlers;
- error semantics;
- sync/async behavior;
- registration;
- Infrastructure leakage;
- можливість заміни in-memory bus;
- поведінку одного failing handler;
- transaction boundary.

### 10. Outbox

Перевір:

- business write + outbox write в одній DB transaction;
- claim/lock strategy;
- `FOR UPDATE SKIP LOCKED` або еквівалент;
- retry;
- stale processing recovery;
- status transitions;
- publish/mark race;
- at-least-once semantics;
- consumer deduplication;
- idempotency key;
- ordering expectations;
- parallel worker behavior.

Не приймай твердження про exactly-once delivery без технічного доказу.

### 11. Auth

Перевір:

- JWT/session strategy selection;
- module boundaries;
- hashing;
- guards/strategies;
- token lifetime;
- refresh/revoke, лише якщо заявлено;
- session storage;
- cookie flags;
- logout;
- залежність від User domain;
- register/login endpoints;
- можливість інтеграції без редагування AuthModule internals.

Не створюй проблему через відсутність refresh token, якщо документація його не заявляє.

### 12. Email і SMS

Перевір:

- ports;
- provider adapters;
- templates;
- queue integration;
- retry;
- idempotency;
- configuration;
- error mapping;
- provider leakage в Application.

### 13. Multi-entrypoint

Окремо перевір:

- API;
- Worker;
- Cron;
- CLI, якщо заявлено.

Для кожного покажи лише проблемний dependency chain.

Перевір:

- окремий composition root;
- мінімальний набір imports;
- відсутність зайвого HTTP server;
- відсутність bootstrap усієї інфраструктури;
- lifecycle і shutdown;
- можливість окремого deployment.

### 14. Production readiness

Не враховуючи тести та Prettier, перевір:

- graceful shutdown;
- liveness/readiness;
- structured logging;
- correlation ID;
- centralized errors;
- observability;
- startup dependency failures;
- Docker flow;
- migration ordering;
- multi-instance behavior;
- silent failures;
- resource cleanup.

---

## Критичність

Використовуй такі критерії:

### Critical

- entrypoint не запускається;
- гарантована втрата, дублювання або пошкодження даних;
- критична security vulnerability;
- migration/outbox flow може необоротно пошкодити production data.

### High

- заявлений модуль або основний flow непрацездатний;
- порушена транзакційність;
- модуль неможливо використовувати незалежно;
- worker/cron/API не можуть запускатися окремо;
- DI падає у runtime;
- architecture boundary системно порушений.

### Medium

- production risk за певних умов;
- некоректне multi-instance behavior;
- слабка конфігурація або lifecycle;
- значне ускладнення заміни adapter;
- документація вводить інтегратора в оману.

### Low

- локальна проблема з незначним runtime або maintenance impact;
- неповна документація;
- невелика неузгодженість без системного впливу.

Не завищуй критичність.

---

## Формат зауваження

### [High][Confirmed defect] Назва проблеми

**Доказ:**

- `src/path/file.ts`
- клас/метод/provider
- релевантний fragment, import chain або результат команди

**Що зараз не так:**

Опиши лише фактичну проблему.

**Чому це проблема:**

Опиши конкретний runtime, data, security, portability або architecture impact.

**Dependency/runtime flow:**

```text
A -> B -> TOKEN -> implementation
```

Додавай цей блок лише коли він допомагає довести проблему.

**Що потрібно змінити:**

Опиши цільову реалізацію.

**Точні зміни:**

1. файл, який потрібно створити або змінити;
2. symbol/provider/import/export, який потрібно змінити;
3. де зареєструвати implementation;
4. які consumer files оновити;
5. чи потрібно оновити документацію.

**Приклад коду:**

Обов’язковий для `Critical` та `High`, якщо виправлення неможливо однозначно описати коротким patch.

Перед кодом вкажи шлях:

```text
src/path/to/file.ts
```

Не відтворюй весь файл, якщо достатньо локального фрагмента.

Для `Medium` та `Low` код додавай лише тоді, коли він справді потрібний.

---

## Документація проти реалізації

Для кожної невідповідності використовуй окремий блок:

**Документація заявляє:**

**Фактична реалізація:**

**Правильна цільова поведінка:**

**Потрібно змінити:**

- код;
- документацію;
- або обидва.

Не вважай документацію автоматично правильною.

---

## Обмеження відповіді

- Не створюй окремий розділ «що зроблено добре».
- Не переказуй структуру репозиторію.
- Не перераховуй коректні модулі без причини.
- Не дублюй одну root cause в кількох зауваженнях.
- Об’єднуй однотипні проблеми.
- Основний список повинен містити максимум 20 найбільш важливих проблем.
- Дрібні додаткові проблеми можна винести в компактний backlog без великих code samples.
- Не вигадуй файли, класи, APIs або конфігурацію.
- Не пропонуй повний rewrite, якщо можливе локальне виправлення.
- Не роби висновок про відсутність механізму, доки не перевіриш усі релевантні imports, registrations і usages.
- Якщо щось не вдалося перевірити, напиши `Не підтверджено` і поясни причину.
- Не використовуй відсутність тестів у фінальній оцінці.

---

## Формат фінального звіту

### 1. Межі перевірки

Коротко:

- які обов’язкові документи прочитані;
- які команди виконані;
- які entrypoint перевірені;
- що неможливо перевірити.

### 2. Критичні та високі проблеми

У порядку:

1. runtime;
2. data integrity;
3. dependency direction;
4. DI;
5. independent module reuse;
6. entrypoint composition.

### 3. Середні та низькі проблеми

Лише проблеми, які реально впливають на production readiness, portability або maintainability.

### 4. Невідповідності документації

Не дублюй проблеми з попередніх розділів — посилайся на відповідний пункт.

### 5. Непідтверджені області

Перелік того, що неможливо було перевірити, без припущень.

### 6. Підсумкова оцінка

## Підсумкова оцінка: X/10

Оцінка базується на фактичному коді та підтвердженій поведінці, а не на кількості створених модулів або заявленій архітектурі.

**Чому не 10/10:**

Вкажи максимум 5 головних причин.

### 7. Що обов’язково зробити для 10/10

Пріоритетний checklist:

1. runtime і DI;
2. data integrity, transactions та Outbox;
3. dependency direction;
4. окремі composition roots;
5. portability/configuration;
6. production readiness;
7. документація.

Для кожного пункту вкажи конкретні файли або symbols.

---

## Оцінювання

- `9.5–10` — production-ready reusable starter; суттєві архітектурні зміни не потрібні.
- `8–9.4` — сильна основа; залишилися окремі важливі недоліки.
- `6–7.9` — правильний напрямок, але потрібні значні виправлення.
- `4–5.9` — модулі формально присутні, але runtime, boundaries або portability суттєво порушені.
- `0–3.9` — заявлена архітектура не реалізована або є системні критичні runtime/data problems.

Не став оцінку вище `9.4`, якщо є хоча б одна невиправлена `High` проблема.

Не став оцінку вище `7.9`, якщо є підтверджена `Critical` проблема.
