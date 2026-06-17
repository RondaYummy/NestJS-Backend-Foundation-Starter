# NestJS Starter Kit — Required Fixes Backlog

Цей файл є statement of work для AI-агента, який виправлятиме результати рев’ю.

Агент повинен:

1. працювати лише над одним ID за раз;
2. перед зміною коду прочитати весь відповідний розділ;
3. не позначати проблему виправленою лише через успішний build;
4. додати окремий implementation report і verification report;
5. не змінювати архітектурний контракт мовчки — якщо виправлення змінює заявлені правила, оновити документацію.

---

# Agent backlog index

## P0 — critical data-integrity defects

| ID      | Source section                                                                |
| ------- | ----------------------------------------------------------------------------- |
| `P0-01` | `1. Зробити lease email idempotency безпечним для довгих jobs`                |
| `P0-02` | `2. Не дозволяти Outbox повторно claim-ити подію під час активної публікації` |

## P1 — high-priority architecture and composition defects

| ID      | Source section                                                                            |
| ------- | ----------------------------------------------------------------------------------------- |
| `P1-01` | `3. Розділити env validation за entrypoint і модулем`                                     |
| `P1-02` | `4. AuthModule повинен створювати лише вибрану auth strategy`                             |
| `P1-03` | `5. Зробити BullMQ registration явною та queue-specific`                                  |
| `P1-04` | `6. Прибрати NestJS decorators з Application layer або змінити задокументований контракт` |
| `P1-05` | `7. Прибрати приховані залежності через @Global()`                                        |
| `P1-06` | `8. Додати typed registration contracts для reusable infrastructure modules`              |

## P2 — medium-priority production-readiness defects

| ID      | Source section                                                              |
| ------- | --------------------------------------------------------------------------- |
| `P2-01` | `9. Не читати Outbox concurrency окремо з process.env у decorator metadata` |
| `P2-02` | `10. Перевіряти результат завершення email idempotency execution`           |
| `P2-03` | `11. Виправити startup log prefix Redis probe`                              |
| `P2-04` | `12. Усунути production dependency та security maintenance debt`            |
| `P2-05` | `13. Зробити lint чистим без послаблення корисних правил`                   |

## P3 — low-priority documentation and maintainability defects

| ID      | Source section                                                                 |
| ------- | ------------------------------------------------------------------------------ |
| `P3-01` | `14. Узгодити документацію з фактичною framework dependence Application layer` |
| `P3-02` | `15. Уточнити гарантії idempotency та at-least-once delivery`                  |
| `P3-03` | `16. Уточнити межі незалежного перенесення модулів`                            |

## Verification backlog

| ID     | Source section                                                   |
| ------ | ---------------------------------------------------------------- |
| `V-01` | `17. Повторити clean install, build, typecheck і lint`           |
| `V-02` | `18. Перевірити bootstrap API, Worker і Cron з мінімальними env` |
| `V-03` | `19. Перевірити email job довший за execution lease`             |
| `V-04` | `20. Перевірити Outbox publish довший за lock TTL`               |
| `V-05` | `21. Перевірити паралельний migration startup`                   |
| `V-06` | `22. Перевірити graceful shutdown активних BullMQ jobs`          |
| `V-07` | `23. Перевірити Docker development і production flows`           |

---

# 1. Зробити lease email idempotency безпечним для довгих jobs

**Severity:** Critical  
**Classification:** Confirmed defect

## Доказ

- `apps/worker/src/processors/email.processor.ts`
- `EXECUTION_TTL_SECONDS = 300`
- `executions.acquire(...)` викликається один раз перед відправкою.
- Під час `mailTemplates.render()` та `mail.send()` lease не продовжується.
- `libs/infrastructure/src/idempotency/redis-job-execution.store.ts` використовує Redis key з TTL як ownership lease.

## Що зараз не так

Worker отримує lock лише на 300 секунд. Якщо рендер або SMTP-виклик триває довше, Redis видаляє ownership key, хоча перший worker все ще виконує job.

Інший delivery тієї самої job після спливу TTL зможе успішно виконати `acquire()` та повторно надіслати лист.

## Приклад, чому не працює

```text
T+0s    worker A acquire(email:123, 300s)
T+10s   worker A починає SMTP send
T+300s  Redis автоматично видаляє lease
T+305s  worker B отримує retry тієї самої job
T+306s  worker B успішно acquire(email:123, 300s)
T+320s  worker A відправляє email
T+330s  worker B також відправляє email
```

Результат: користувач отримує два листи, хоча в job є `idempotencyKey`.

## Що потрібно змінити

Реалізувати renewable ownership lease або перейти до state model, де активний execution має heartbeat і fencing token.

Мінімальна цільова поведінка:

1. `acquire()` повертає ownership token;
2. worker періодично продовжує TTL лише якщо Redis value досі дорівнює token;
3. heartbeat зупиняється у `finally`;
4. якщо ownership втрачено до side effect, job не надсилає email;
5. завершення execution виконується compare-and-set операцією;
6. TTL і heartbeat interval конфігуруються, а не hardcoded.

## Точні зміни

1. Змінити `libs/contracts/src/idempotency/job-execution-store.ts`.
2. Додати метод на кшталт `extend(key, ownershipToken, ttlSeconds): Promise<boolean>`.
3. Реалізувати atomic Lua script у `libs/infrastructure/src/idempotency/redis-job-execution.store.ts`.
4. Оновити `apps/worker/src/processors/email.processor.ts`.
5. Винести TTL/heartbeat interval у typed worker configuration.
6. Додати integration test з job, що працює довше за початковий TTL.

## Приклад цільового contract

`libs/contracts/src/idempotency/job-execution-store.ts`

```ts
export interface IJobExecutionStore {
  acquire(key: string, ttlSeconds: number): Promise<string | null>;
  extend(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;
  complete(key: string, ownershipToken: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, ownershipToken: string): Promise<void>;
}
```

---

# 2. Не дозволяти Outbox повторно claim-ити подію під час активної публікації

**Severity:** Critical  
**Classification:** Confirmed defect

## Доказ

- `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`
- `claimPendingBatch()` вважає `processing` row простроченим, коли `lockedAt < now - lockTtlMs`.
- Після claim поле `lockedAt` більше не оновлюється.
- `publishEvent()` виконується поза DB transaction і може тривати необмежений час.

## Що зараз не так

Outbox lease є фіксованим timestamp без heartbeat. Якщо handler або зовнішня інтеграція працює довше за `OUTBOX_LOCK_TTL_MS`, інший worker може повторно claim-ити ту саму подію, поки перший worker ще публікує її.

## Приклад, чому не працює

```text
lockTtlMs = 300000

12:00:00 worker A claim event E, lockedAt=12:00:00
12:00:10 worker A починає повільний handler
12:05:01 worker B бачить lockedAt як expired
12:05:02 worker B claim event E
12:05:10 worker A завершує зовнішній side effect
12:05:15 worker B повторює той самий side effect
```

`lockedBy` захищає лише фінальне оновлення row. Він не скасовує вже виконаний зовнішній side effect.

## Що потрібно змінити

Обрати й реалізувати один чіткий lease protocol:

- renewable lease/heartbeat для кожного claimed event;
- або sufficiently bounded handler timeout плюс lock TTL, який гарантовано більший за timeout;
- або claim по одному event з heartbeat і fencing token.

Рекомендований варіант — heartbeat з conditional update:

```text
UPDATE outbox_events
SET locked_at = now()
WHERE id = :id
  AND status = 'processing'
  AND locked_by = :workerId
```

Якщо heartbeat повернув 0 rows, worker втратив ownership і не повинен продовжувати наступні локальні кроки.

## Точні зміни

1. Змінити `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`.
2. Додати configurable heartbeat interval і handler timeout у `OutboxProcessorOptions`.
3. Оновити `libs/contracts/src/outbox/outbox-processor.options.ts`.
4. Оновити env schema та `AppConfigService` mapping.
5. Додати integration test з двома processor instances і handler latency, більшою за lock TTL.
6. Задокументувати at-least-once semantics: навіть після виправлення consumer handlers мають бути idempotent.

---

# 3. Розділити env validation за entrypoint і модулем

**Severity:** High  
**Classification:** Confirmed architectural defect

## Доказ

- `libs/infrastructure/src/config/env.schema.ts` містить єдину schema для API, Worker і Cron.
- `DATABASE_URL`, `JWT_SECRET` і `JWT_REFRESH_SECRET` обов’язкові завжди.
- `InfrastructureConfigModule` імпортується в усі composition roots.

## Що зараз не так

Кожен entrypoint повинен мати env для всіх модулів starter kit, навіть коли ці модулі не використовуються.

Наприклад, Cron, який лише ставить Outbox job у Redis, не повинен вимагати JWT secrets, SMTP credentials або S3 configuration.

## Приклад, чому не працює

```env
# Мінімальний cron deployment
REDIS_HOST=redis
REDIS_PORT=6379
```

Cron не bootstrap-иться, бо global schema одночасно вимагає:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
```

Це робить entrypoint deployment залежним від непотрібних секретів.

## Що потрібно змінити

Створити composable schemas:

```text
baseEnvSchema
redisEnvSchema
bullMqEnvSchema
apiEnvSchema
workerEnvSchema
cronEnvSchema
mailEnvSchema
storageEnvSchema
outboxEnvSchema
```

Composition root повинен збирати лише потрібні schemas.

## Точні зміни

1. Розділити `libs/infrastructure/src/config/env.schema.ts`.
2. Зробити `InfrastructureConfigModule.forRoot({ schema })` або окремі typed config modules.
3. Оновити `apps/api/src/api.module.ts`.
4. Оновити `apps/worker/src/worker.module.ts`.
5. Оновити `apps/cron/src/cron.module.ts`.
6. Додати bootstrap verification з мінімальним env для кожного entrypoint.

---

# 4. AuthModule повинен створювати лише вибрану auth strategy

**Severity:** High  
**Classification:** Confirmed architectural defect

## Доказ

`libs/infrastructure/src/auth/auth.module.ts` завжди реєструє:

```text
RedisSessionStore
RedisJwtTokenStore
JwtAuthTokenService
SessionAuthTokenService
```

Factory для `TOKENS.AuthTokenService` лише вибирає один уже створений instance.

## Що зараз не так

`AUTH_DRIVER=session` не відключає JWT infrastructure, а `AUTH_DRIVER=jwt` не відключає session infrastructure.

Обидві strategy створюються, їхні constructor dependencies повинні бути доступні, а невибрана strategy може запускати непотрібну ініціалізацію.

## Приклад, чому не працює

```text
AUTH_DRIVER=session
  -> Nest все одно створює JwtAuthTokenService
  -> Nest все одно створює RedisJwtTokenStore
  -> JWT-specific dependencies залишаються частиною runtime graph
```

Це не справжній strategy selection, а лише selection return value.

## Що потрібно змінити

Перетворити AuthModule на dynamic module:

```ts
AuthModule.forRoot({ driver: 'jwt' })
AuthModule.forRoot({ driver: 'session' })
AuthModule.forRootAsync(...)
```

Dynamic module повинен додавати providers лише вибраної strategy.

## Точні зміни

1. Змінити `libs/infrastructure/src/auth/auth.module.ts`.
2. Додати typed options та injection token.
3. Розділити JWT і Session provider arrays/modules.
4. Оновити `apps/api/src/composition/auth-application.module.ts`.
5. Перевірити, що session mode не потребує JWT secrets, а JWT mode не створює session adapter без потреби.

---

# 5. Зробити BullMQ registration явною та queue-specific

**Severity:** High  
**Classification:** Architectural risk

## Доказ

`libs/infrastructure/src/bullmq/bullmq.module.ts`:

```ts
@Global()
BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name })))
```

Один module завжди реєструє всі queue names і стає global.

## Що зараз не так

Composition root не декларує, які саме queues він producer/consumer-ить.

Cron для Outbox автоматично отримує email queue. Worker для email автоматично отримує всі майбутні queues. Нове queue name непомітно змінить runtime graph усіх entrypoints.

## Приклад, чому не працює

```text
Додали QUEUES.REPORTS
  -> CronModule автоматично реєструє REPORTS
  -> WorkerModule автоматично реєструє REPORTS
  -> жоден composition root явно цього не просив
```

## Що потрібно змінити

Додати typed registration:

```ts
InfrastructureBullMqModule.forRoot({ queues: [QUEUES.OUTBOX] });
InfrastructureBullMqModule.forRoot({ queues: [QUEUES.EMAIL, QUEUES.OUTBOX] });
```

Не використовувати `@Global()`.

## Точні зміни

1. Змінити `libs/infrastructure/src/bullmq/bullmq.module.ts`.
2. Додати `forRoot`/`forRootAsync` options.
3. Оновити Worker composition root.
4. Оновити Cron composition root.
5. API підключати лише producer queues, які реально використовує.

---

# 6. Прибрати NestJS decorators з Application layer або змінити задокументований контракт

**Severity:** High  
**Classification:** Confirmed architectural defect

## Доказ

Усі auth use cases у `libs/application/src/use-cases/auth/*` імпортують `@nestjs/common` і використовують `@Injectable()` / `@Inject()`.

## Що зараз не так

Документація описує Application як внутрішній шар, що залежить від contracts/ports, але реалізація напряму залежить від NestJS DI framework.

## Приклад, чому не працює

Use case неможливо перенести в non-Nest runtime без зміни source code:

```ts
import { Inject, Injectable } from '@nestjs/common';
```

Це суперечить заявленій framework-independent Onion boundary.

## Що потрібно змінити

Рекомендований варіант:

- use cases зробити plain TypeScript classes;
- provider binding описати у composition module через factories;
- injection tokens залишити у composition/infrastructure layer.

Альтернативно — чесно задокументувати Application як NestJS-aware layer. Не можна одночасно заявляти framework independence і залишати decorators.

## Точні зміни

1. Оновити всі файли `libs/application/src/use-cases/auth/*.ts`.
2. Оновити `apps/api/src/composition/auth-application.module.ts`.
3. Додати explicit factory providers.
4. Оновити README і architecture rules.

---

# 7. Прибрати приховані залежності через @Global()

**Severity:** High  
**Classification:** Architectural risk

## Доказ

`@Global()` використано у:

- `auth/auth.module.ts`
- `bullmq/bullmq.module.ts`
- `database/drizzle/drizzle.module.ts`
- `redis/redis.module.ts`
- `repositories/repositories.module.ts`
- `transactions/transactions.module.ts`

## Що зараз не так

Provider visibility залежить не лише від imports конкретного module, а від того, чи був global module колись завантажений у composition root.

Це приховує dependency chain і створює помилки при незалежному перенесенні module.

## Приклад, чому не працює

Module може успішно працювати у starter kit лише тому, що RedisModule був завантажений іншим root import. Після копіювання module в інший проєкт Nest видасть `UnknownDependenciesException`.

## Що потрібно змінити

- прибрати `@Global()` з reusable modules;
- кожен consumer module повинен явно import module, який export-ить потрібний token;
- залишити global лише для справді cross-cutting bootstrap concerns, якщо це обґрунтовано.

## Точні зміни

Оновити перелічені modules та перевірити повний dependency graph для API, Worker і Cron.

---

# 8. Додати typed registration contracts для reusable infrastructure modules

**Severity:** High  
**Classification:** Architectural risk

## Доказ

Redis, Drizzle, Mail, Storage, Rate Limiter, Locks, Cache та частина Auth configuration отримують налаштування лише через один `AppConfigService` і global env module.

## Що зараз не так

Модулі не мають власного публічного typed contract для перенесення в інший проєкт. Для використання module необхідно переносити спільний config implementation або редагувати internals.

## Приклад, чому не працює

Щоб перенести `MailModule`, недостатньо скопіювати mail folder. Він імпортує:

```text
InfrastructureConfigModule
AppConfigService
LoggerModule
```

Отже заявлена незалежна переносимість module не виконується буквально.

## Що потрібно змінити

Для reusable modules додати:

```text
forRoot(options)
forRootAsync({ imports, inject, useFactory })
MODULE_OPTIONS_TOKEN
public options interface
```

Почати з Redis, Drizzle, BullMQ, Mail, Storage та Auth.

---

# 9. Не читати Outbox concurrency окремо з process.env у decorator metadata

**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- Runtime processor options надаються через `OutboxProcessorModule.forRootAsync(...)`.
- Але `apps/worker/src/processors/outbox.processor.ts` викликає `buildOutboxProcessorDecoratorOptions()`.
- Ця функція повторно читає `process.env` через `resolveOutboxOptionsFromEnv()`.
- При invalid env вона мовчки повертає defaults.

## Що зараз не так

Один Outbox processor має два незалежні configuration paths:

```text
Nest DI options -> batch size, TTL, retry
process.env at module evaluation -> BullMQ concurrency
```

Вони можуть розійтися.

## Приклад, чому не працює

При programmatic configuration:

```ts
OutboxProcessorModule.forRoot({ concurrency: 8, ... })
```

decorator все одно може отримати `concurrency: 1` із default env path.

## Що потрібно змінити

Не використовувати `process.env` у decorator helper. Реєструвати consumer через dynamic BullMQ configuration або встановлювати concurrency у єдиному composition contract.

---

# 10. Перевіряти результат завершення email idempotency execution

**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

`RedisJobExecutionStore.complete()` повертає `boolean`, але `EmailProcessor` ігнорує результат.

## Що зараз не так

`false` означає, що worker більше не володіє execution key. Проте job завершується успішно, ніби idempotency state гарантовано записаний.

## Приклад, чому не працює

```text
email успішно відправлено
complete(...) -> false
BullMQ job -> completed
Redis marker "completed" відсутній
наступний duplicate delivery -> може повторно виконати send
```

## Що потрібно змінити

Явно обробляти `false`:

- логувати ownership loss;
- не стверджувати, що idempotency completion успішний;
- у поєднанні з P0-01 використовувати heartbeat/fencing protocol.

---

# 11. Виправити startup log prefix Redis probe

**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

`libs/infrastructure/src/redis/assert-redis-available.ts` завжди логгує:

```text
[worker-startup]
```

Ця сама функція викликається з API, Worker і Cron entrypoint.

## Що зараз не так

API та Cron logs помилково маркуються як Worker logs, що ускладнює incident diagnosis.

## Приклад

При падінні Redis під час API startup оператор бачить:

```text
[worker-startup] Redis connection attempt ... failed
```

хоча падає API container.

## Що потрібно змінити

Передавати `componentName`/logger у startup probe або не вбудовувати component prefix у reusable utility.

---

# 12. Усунути production dependency та security maintenance debt

**Severity:** Medium  
**Classification:** Confirmed production-readiness risk

## Доказ

`npm ci` завершився, але npm повідомив:

```text
23 vulnerabilities (20 moderate, 3 high)
```

Також кілька `@react-email/*` packages позначені npm як deprecated/unsupported.

## Що зараз не так

Starter kit фіксує dependency tree з відомими high vulnerabilities і unsupported packages. Це не доводить exploitability конкретного runtime path, але є production maintenance risk.

## Що потрібно змінити

1. Виконати `npm audit --omit=dev` окремо від dev-only findings.
2. Для кожної high vulnerability визначити direct/transitive package і runtime reachability.
3. Оновити dependency versions без `npm audit fix --force` навмання.
4. Замінити unsupported React Email package set на підтримуваний release path.
5. Зафіксувати accepted residual risks.

---

# 13. Зробити lint чистим без послаблення корисних правил

**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

Команда:

```bash
npm run lint
```

Результат:

```text
libs/infrastructure/src/mail/null-mail.adapter.ts
Async method 'send' has no 'await' expression
@typescript-eslint/require-await
```

## Що зараз не так

Repository не проходить власний `lint --max-warnings=0`.

## Що потрібно змінити

Виправити contract/implementation локально. Не вимикати правило глобально.

Наприклад, якщо interface допускає `Promise<void>`, implementation може повертати resolved promise без `async`:

```ts
send(...): Promise<void> {
  return Promise.resolve();
}
```

Після зміни повторити lint.

---

# 14. Узгодити документацію з фактичною framework dependence Application layer

**Severity:** Low  
**Classification:** Documentation mismatch

## Документація заявляє

Application layer є внутрішнім шаром та залежить від ports/contracts, а не framework implementation.

## Фактична реалізація

Application use cases імпортують NestJS DI decorators.

## Правильна цільова поведінка

Виконати P1-04 або змінити документацію так, щоб вона чесно називала Application NestJS-aware.

---

# 15. Уточнити гарантії idempotency та at-least-once delivery

**Severity:** Low  
**Classification:** Documentation mismatch

## Що потрібно уточнити

Документація не повинна створювати враження exactly-once side effects.

Після P0-01 і P0-02 все одно залишаються crash windows:

```text
external side effect успішний
process падає до local completion marker
retry повторює delivery
```

Правильна гарантія:

- transport/outbox — at-least-once;
- handlers та provider calls мають idempotency key;
- exactly-once можливий лише за підтримки downstream system або спільної transaction boundary.

---

# 16. Уточнити межі незалежного перенесення модулів

**Severity:** Low  
**Classification:** Documentation mismatch

## Документація заявляє

Infrastructure modules можна переносити між проєктами незалежно.

## Фактична реалізація

Більшість modules залежать від shared `InfrastructureConfigModule`, `AppConfigService`, global modules і project path aliases.

## Правильна цільова поведінка

Після P1-05/P1-06 документація повинна для кожного module містити:

- required peer modules;
- public tokens;
- required options;
- sync/async registration example;
- required migrations/schema;
- required lifecycle hooks.

---

# 17. Повторити clean install, build, typecheck і lint

**ID:** `V-01`

Виконати:

```bash
rm -rf node_modules dist
npm ci
npm run build
npx tsc --noEmit
npm run lint
```

Acceptance criteria:

- усі команди завершуються code 0;
- немає engine mismatch для заявленого мінімального Node version;
- lint не вимикається глобальним послабленням правил.

---

# 18. Перевірити bootstrap API, Worker і Cron з мінімальними env

**ID:** `V-02`

Для кожного entrypoint створити окремий minimal env fixture.

Acceptance criteria:

- API не вимагає worker-only configuration;
- Worker не вимагає API cookie/CORS configuration;
- Cron не вимагає JWT/SMTP/S3 secrets, якщо не імпортує ці modules;
- expected infrastructure errors відокремлені від DI/config errors.

---

# 19. Перевірити email job довший за execution lease

**ID:** `V-03`

Test scenario:

1. TTL = 2 seconds.
2. Перший processor блокується на 5 секунд у fake email gateway.
3. Запускається другий delivery з тим самим key.
4. Зафіксувати кількість викликів gateway.

Acceptance criteria:

```text
email gateway called exactly once
```

---

# 20. Перевірити Outbox publish довший за lock TTL

**ID:** `V-04`

Test scenario:

1. Два processor instances.
2. lock TTL = 2 seconds.
3. Handler latency = 5 seconds.
4. Обидва processors запускають `processPending()`.

Acceptance criteria:

- активна подія не виконується паралельно двома owners;
- ownership loss не маскується як успішна публікація;
- документація все одно фіксує at-least-once semantics.

---

# 21. Перевірити паралельний migration startup

**ID:** `V-05`

Запустити два migration processes одночасно проти чистої PostgreSQL database.

Перевірити:

- чи Drizzle migration journal/locking запобігає подвійному DDL;
- чи один process коректно чекає або завершується;
- чи database не залишається частково мігрованою.

Якщо гарантії бібліотеки недостатні, додати PostgreSQL advisory lock навколо migration runner.

---

# 22. Перевірити graceful shutdown активних BullMQ jobs

**ID:** `V-06`

Test scenario:

1. Запустити довгу email/outbox job.
2. Надіслати SIGTERM worker container.
3. Перевірити поведінку протягом `stop_grace_period`.

Acceptance criteria:

- worker припиняє брати нові jobs;
- активна job або завершується, або безпечно повертається для retry;
- Redis/PG connections закриваються;
- немає duplicate side effect через неправильний lease protocol.

---

# 23. Перевірити Docker development і production flows

**ID:** `V-07`

Перевірити обидва сценарії:

```bash
docker compose up --build
```

та production image:

```bash
docker build --target runtime -t starter:review .
```

Acceptance criteria:

- migrations folder доступний у runtime image;
- `start:prod:*` paths відповідають фактичному build output;
- API, Worker і Cron можуть запускатися окремими runtime containers;
- health/readiness відображають реальний стан dependencies.

---

# Перевірки, виконані під час рев’ю

## Clean install

```text
Команда: npm ci
Результат: успішно, code 0
Додатково: npm повідомив 23 vulnerabilities — 20 moderate, 3 high.
```

## Build

```text
Команда: npm run build
Результат: успішно, code 0
Entrypoints: api, worker, cron, migrations
```

## TypeScript

```text
Команда: npx tsc --noEmit
Результат: успішно, code 0
```

## Lint

```text
Команда: npm run lint
Результат: code 1
Причина: require-await у null-mail.adapter.ts
```

## Runtime bootstrap

```text
Не підтверджено повністю.
Причина: рев’ю-середовище не мало піднятих PostgreSQL, Redis та SMTP services для повного integration startup.
Build/typecheck не замінюють runtime DI/bootstrap verification.
```

---

# Status model

```text
open
  -> plan proposed
  -> plan approved by human
  -> implemented
  -> independently verified
  -> accepted by human
```

Не редагувати цей backlog, щоб заявити про завершення задачі. Стан виконання зберігати у plan/report history або issue tracker.

Для кожного ID AI-агент повинен створити:

```text
.agent/plans/<ID>-plan.md
.agent/reports/<ID>-implementation.md
.agent/reports/<ID>-verification.md
```
