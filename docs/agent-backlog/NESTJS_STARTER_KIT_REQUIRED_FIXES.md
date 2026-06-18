# NestJS Starter Kit — Required Fixes Backlog

> **Актуалізовано:** 18 червня 2026 року  
> **Baseline:** `NestJS-Backend-Foundation-Starter(40).zip`  
> **Призначення:** statement of work для AI-агента, який виправлятиме підтверджені проблеми поточної версії starter kit.

Цей файл містить лише **відкриті** задачі. Проблеми, які вже виправлені в поточному архіві, винесені в розділ **«Вже реалізовано — не виконувати повторно»**.

Агент повинен:

1. працювати лише над одним ID за раз;
2. перед зміною коду прочитати весь відповідний розділ;
3. перевіряти повний dependency/runtime flow, а не лише локальний файл;
4. не позначати проблему виправленою лише через успішний build;
5. додати окремий implementation report і verification report;
6. не змінювати архітектурний контракт мовчки — якщо виправлення змінює заявлені правила, оновити документацію;
7. не закривати security/data-integrity задачу без негативного сценарію, який відтворював дефект до виправлення;
8. не використовувати `npm audit fix --force`, глобальне вимкнення lint rules або спрощення типів як заміну цільовому виправленню.

---

# Agent backlog index

## P0 — critical defects

У поточному baseline немає окремої підтвердженої `Critical` проблеми. Не підвищувати severity без runtime/data/security доказу.

## P1 — high-priority security, runtime and architecture defects

| ID      | Source section                                                                       |
| ------- | ------------------------------------------------------------------------------------ |
| `P1-01` | `1. Закрити path traversal у LocalStorageAdapter`                                    |
| `P1-02` | `2. Не дозволяти помилці cron tick завершувати Cron process`                         |
| `P1-03` | `3. Посилити production validation JWT secrets`                                      |
| `P1-04` | `5. Зробити infrastructure modules незалежно конфігурованими та явно скомпонованими` |

## P2 — medium-priority production-readiness and portability defects

| ID      | Source section                                                                       |
| ------- | ------------------------------------------------------------------------------------ |
| `P2-01` | `6. Серіалізувати паралельні запуски PostgreSQL migrations`                          |
| `P2-02` | `7. Узгодити QueueJobRegistry з усіма зареєстрованими BullMQ queues`                 |
| `P2-03` | `8. Реалізувати справжню semantics forgetByPattern()`                                |
| `P2-04` | `9. Не повертати Outbox event у retry, поки timeouted handler продовжує side effect` |
| `P2-05` | `10. Додати bounded deadlines для readiness checks`                                  |
| `P2-06` | `11. Перевіряти актуальний User під час refresh/session authorization`               |
| `P2-07` | `12. Обробляти втрату ownership під час завершення email execution`                  |
| `P2-08` | `13. Прибрати другий process.env configuration path для Outbox concurrency`          |
| `P2-09` | `14. Зробити Redis startup probe component-aware`                                    |
| `P2-10` | `15. Усунути 8 high vulnerabilities у production dependency graph`                   |
| `P2-11` | `16. Не включати .env та credential-like values у starter distribution`              |

## P3 — low-priority documentation and compatibility defects

| ID      | Source section                                                       |
| ------- | -------------------------------------------------------------------- |
| `P3-01` | `17. Узгодити Node engines з фактичними dependency requirements`     |
| `P3-02` | `18. Не заявляти users feature як реалізовану, якщо це лише приклад` |
| `P3-03` | `19. Документувати чотири entrypoint, включно з Migrations`          |
| `P3-04` | `20. Виправити інструкцію додавання BullMQ queue/job`                |
| `P3-05` | `21. Узгодити cache документацію з реальною pattern semantics`       |
| `P3-06` | `22. Уточнити гарантії idempotency, at-least-once та portability`    |

## Verification backlog

| ID     | Source section                                                            |
| ------ | ------------------------------------------------------------------------- |
| `V-01` | `23. Повторити clean install, build, typecheck, lint та production audit` |
| `V-02` | `24. Перевірити bootstrap усіх чотирьох entrypoint з мінімальними env`    |
| `V-03` | `25. Перевірити LocalStorage traversal negative cases`                    |
| `V-04` | `26. Перевірити Cron після transient Redis/BullMQ failure`                |
| `V-05` | `27. Перевірити production JWT secret policy`                             |
| `V-06` | `28. Перевірити parallel migration startup`                               |
| `V-07` | `29. Перевірити Outbox timeout, lease та duplicate-side-effect сценарії`  |
| `V-08` | `30. Перевірити readiness deadline під час dependency outage`             |
| `V-09` | `31. Перевірити role revoke, user disable та authVersion flow`            |
| `V-10` | `32. Перевірити QueueGateway для всіх заявлених queues`                   |
| `V-11` | `33. Перевірити pattern cache invalidation`                               |
| `V-12` | `34. Перевірити graceful shutdown активних BullMQ jobs`                   |
| `V-13` | `35. Перевірити Docker development і production flows`                    |
| `V-14` | `36. Перевірити release artifact на secrets та зайві файли`               |

---

# 1. Закрити path traversal у LocalStorageAdapter

**ID:** `P1-01`  
**Severity:** High  
**Classification:** Confirmed defect

## Доказ

- `libs/infrastructure/src/storage/local-storage.adapter.ts`
- symbol: `LocalStorageAdapter.path()`

Поточна реалізація об’єднує configured root та caller-provided key без containment validation:

```ts
private path(key: string): string {
  return join(this.config.storage().localPath, key);
}
```

Ключ `../outside.txt` резолвиться поза `LOCAL_STORAGE_PATH`.

## Що зараз не так

`putObject`, `getObject`, `deleteObject` і `getSignedUrl` можуть працювати з файлом поза storage root, якщо key містить `..`, absolute path, platform-specific separators або іншу path traversal форму.

## Чому це проблема

Consumer, який передає user-controlled object key, може прочитати, перезаписати або видалити файл з правами Node.js process. Для reusable storage adapter це security defect незалежно від того, чи є upload endpoint у demo feature.

## Dependency/runtime flow

```text
Controller/Application
  -> TOKENS.StorageGateway
    -> LocalStorageAdapter
      -> path.join(basePath, untrustedKey)
        -> fs read/write/rm outside storage root
```

## Що потрібно змінити

1. Резолвити root і target в absolute paths.
2. Перевіряти, що target залишається всередині root.
3. Відхиляти:
   - порожній key;
   - absolute path;
   - NUL byte;
   - traversal segments;
   - key, який резолвиться у сам root, якщо object key повинен означати файл.
4. Не використовувати filesystem path як public URL без окремої URL policy.
5. Зафіксувати у contract/docs, що storage key — це relative object key, а не filesystem path.

## Точні зміни

1. Змінити `libs/infrastructure/src/storage/local-storage.adapter.ts`.
2. Додати локальний helper на кшталт `resolveContainedStoragePath(root, key)`.
3. Додати `InvalidStorageKeyError` або іншу domain-neutral infrastructure error.
4. Додати targeted tests для Windows і POSIX separators.
5. Оновити storage integration section у `README.md`/`EXAMPLES.md`.

## Приклад коду

`libs/infrastructure/src/storage/local-storage.adapter.ts`

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

private path(key: string): string {
  if (!key || key.includes('\0') || isAbsolute(key)) {
    throw new InvalidStorageKeyError(key);
  }

  const root = resolve(this.options.localPath);
  const target = resolve(root, key);
  const relativePath = relative(root, target);

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new InvalidStorageKeyError(key);
  }

  return target;
}
```

Acceptance criteria визначені у `V-03`.

---

# 2. Не дозволяти помилці cron tick завершувати Cron process

**ID:** `P1-02`  
**Severity:** High  
**Classification:** Confirmed defect

## Доказ

- `apps/cron/src/schedules/outbox.schedule.ts`
- symbol: `OutboxSchedule.onModuleInit()`

Поточний timer boundary ігнорує rejected Promise:

```ts
const interval = setInterval(() => {
  void this.tick();
}, this.options.pollIntervalMs);
```

`tick()` може reject через Redis distributed lock або BullMQ queue operation.

## Що зараз не так

Transient Redis/BullMQ error після успішного startup стає unhandled rejection. У поточному Node runtime це може завершити Cron process з exit code 1.

## Чому це проблема

Одиничний dependency outage повністю зупиняє scheduling flow замість логування помилки та наступної спроби.

## Dependency/runtime flow

```text
setInterval
  -> OutboxSchedule.tick()
    -> IDistributedLock
    -> IQueueGateway.add()
  -> rejected Promise without boundary handler
  -> unhandledRejection
  -> process exit
```

## Що потрібно змінити

1. Обробляти rejection на timer boundary.
2. Логувати component, operation та normalized error.
3. Не зупиняти наступні ticks після transient failure.
4. Не викликати `process.exit()` для runtime tick error.
5. Зберегти local/distributed overlap protection.
6. Не допускати паралельного tick, якщо попередній ще виконується.

## Точні зміни

1. Змінити `apps/cron/src/schedules/outbox.schedule.ts`.
2. Inject `AppLogger` або окремий scheduler logger port.
3. Додати `.catch()` на Promise, створений timer callback.
4. Додати metric/counter hook, якщо observability contract уже підтримується.
5. Додати failure/recovery scenario з `V-04`.

## Приклад коду

`apps/cron/src/schedules/outbox.schedule.ts`

```ts
onModuleInit(): void {
  const interval = setInterval(() => {
    void this.tick().catch((error: unknown) => {
      this.logger.error('Outbox cron tick failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, this.options.pollIntervalMs);

  this.schedulerRegistry.addInterval(OUTBOX_SCHEDULE_INTERVAL_NAME, interval);
}
```

---

# 3. Посилити production validation JWT secrets

**ID:** `P1-03`  
**Severity:** High  
**Classification:** Confirmed defect

## Доказ

- `libs/infrastructure/src/config/env.schema.ts`

Поточні правила:

```ts
JWT_SECRET: z.string().min(1),
JWT_REFRESH_SECRET: z.string().min(1),
```

У `NODE_ENV=production` приймаються односивольні й однакові access/refresh secrets.

## Що зараз не так

Production validation не перевіряє:

- мінімальну cryptographic entropy/length;
- whitespace-only values;
- known development/default values;
- відмінність access та refresh secret.

## Чому це проблема

Слабкий або відомий secret дозволяє підробляти JWT. Однакові access/refresh secrets зменшують ізоляцію між token types і збільшують blast radius витоку.

## Що потрібно змінити

1. Для production вимагати достатню довжину secret.
2. Відхиляти known/default placeholders.
3. Вимагати різні access і refresh secrets.
4. Додати secure generation instructions.
5. Не зберігати реальні secrets у `.env.example`, Dockerfile або Compose defaults.

## Точні зміни

1. Оновити `libs/infrastructure/src/config/env.schema.ts`.
2. Оновити `.env.example`.
3. Оновити `DOCKER_PRODUCTION.md` і deployment section у `README.md`.
4. Додати negative/positive schema tests.

## Приклад коду

`libs/infrastructure/src/config/env.schema.ts`

```ts
const forbiddenSecrets = new Set(['change-me', 'dev-secret', 'dev-refresh-secret-change-me']);

// inside superRefine
if (env.NODE_ENV === 'production') {
  for (const [field, rawValue] of [
    ['JWT_SECRET', env.JWT_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
  ] as const) {
    const value = rawValue.trim();

    if (value.length < 32 || forbiddenSecrets.has(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} must be at least 32 characters and must not use a default value`,
      });
    }
  }

  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_REFRESH_SECRET'],
      message: 'JWT access and refresh secrets must be different',
    });
  }
}
```

---

# 4. Прибрати NestJS decorators з Application layer

**ID:** `P1-04`  
**Severity:** High  
**Classification:** Architectural risk confirmed by imports

## Доказ

NestJS imports є в auth use cases:

- `libs/application/src/use-cases/auth/get-current-user.usecase.ts`
- `libs/application/src/use-cases/auth/login.usecase.ts`
- `libs/application/src/use-cases/auth/logout.usecase.ts`
- `libs/application/src/use-cases/auth/refresh-auth-session.usecase.ts`
- `libs/application/src/use-cases/auth/register.usecase.ts`

Use cases використовують `@Injectable()` та `@Inject()`.

## Що зараз не так

Application classes залежать від NestJS DI metadata. Це суперечить заявленій strict Onion boundary, де Application залежить від contracts/ports, а framework wiring знаходиться у composition root.

## Чому це проблема

- use cases не є plain TypeScript classes;
- переносення у CLI, інший framework або окремий package потребує NestJS;
- composition concerns змішані з business orchestration;
- architecture rule не захищена автоматично.

## Що потрібно змінити

1. Прибрати `@nestjs/*` imports з `libs/application`.
2. Залишити constructor dependencies як TypeScript interfaces.
3. Зареєструвати use cases explicit factory providers у composition modules.
4. Додати architecture lint rule/restriction.
5. Не переносити contracts у Infrastructure лише заради DI.

## Точні зміни

1. Оновити всі `libs/application/src/use-cases/auth/*.ts`.
2. Оновити `apps/api/src/composition/auth-application.module.ts`.
3. Додати import restriction для `libs/application/** -> @nestjs/**`.
4. Оновити architecture section у `README.md`.

## Приклад коду

`libs/application/src/use-cases/auth/login.usecase.ts`

```ts
export class LoginUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly authTokenService: IAuthTokenService,
  ) {}
}
```

`apps/api/src/composition/auth-application.module.ts`

```ts
{
  provide: LoginUseCase,
  inject: [TOKENS.UserRepository, TOKENS.PasswordHasher, TOKENS.AuthTokenService],
  useFactory: (
    users: IUserRepository,
    hasher: IPasswordHasher,
    auth: IAuthTokenService,
  ) => new LoginUseCase(users, hasher, auth),
}
```

---

# 5. Зробити infrastructure modules незалежно конфігурованими та явно скомпонованими

**ID:** `P1-05`  
**Severity:** High  
**Classification:** Confirmed architecture/portability defect

## Доказ

Лише `OutboxProcessorModule` має окремий typed configurable contract. Ключові modules hard-wired до starter-specific `AppConfigService` та global env contract:

- `libs/infrastructure/src/config/infrastructure-config.module.ts`
- `libs/infrastructure/src/config/env.schema.ts`
- `libs/infrastructure/src/redis/redis.module.ts`
- `libs/infrastructure/src/database/drizzle/drizzle.module.ts`
- `libs/infrastructure/src/bullmq/bullmq.module.ts`
- `libs/infrastructure/src/mail/mail.module.ts`
- `libs/infrastructure/src/storage/storage.module.ts`
- `libs/infrastructure/src/auth/auth.module.ts`
- `libs/infrastructure/src/repositories/repositories.module.ts`
- `libs/infrastructure/src/transactions/transactions.module.ts`

Частина modules використовує `@Global()`. BullMQ module реєструє всі queues. Auth, Mail і Storage створюють обидві implementation, а factory лише повертає вибрану.

## Що зараз не так

Окремий module неможливо перенести та сконфігурувати без перенесення:

```text
InfrastructureConfigModule
  -> ConfigModule.forRoot(isGlobal=true)
    -> full envSchema
      -> unrelated DB/JWT/Redis/Mail/Storage/Outbox variables
```

Composition roots не показують повний dependency graph, а inactive adapters все одно створюються Nest container.

## Чому це проблема

Порушені базові вимоги starter kit:

- module переноситься незалежно;
- підключається лише за потреби;
- configurable без редагування internals;
- не покладається на hidden global dependency;
- entrypoint не вимагає unrelated secrets/configuration;
- inactive provider-specific implementation не запускається.

## Цільова архітектура

Для Redis, Drizzle, BullMQ, Mail, Storage та Auth потрібні public typed contracts:

```ts
SomeModule.forRoot(options);
SomeModule.forRootAsync({ imports, inject, useFactory });
```

Starter-specific env mapping повинен залишатися в `apps/*` composition roots або окремих adapter modules, а не всередині reusable module.

## Що потрібно змінити

1. Розділити monolithic env validation на composable schemas:
   - base;
   - API;
   - Worker;
   - Cron;
   - Migrations;
   - Redis;
   - Drizzle;
   - BullMQ;
   - Mail;
   - Storage;
   - Auth;
   - Outbox.
2. Додати `forRoot`/`forRootAsync` typed options contracts.
3. Прибрати `@Global()` за замовчуванням; global mode може бути лише explicit opt-in.
4. Зареєструвати лише потрібні queues для конкретного entrypoint.
5. Створювати лише активний Auth/Mail/Storage adapter.
6. Явно import/export provider tokens у consumer modules.
7. Оновити API/Worker/Cron/Migrations composition roots.
8. Документувати peer dependencies, tokens, required migrations і lifecycle кожного module.

## Точні зміни

1. Створити options/token files у кожному module folder.
2. Переробити перелічені modules через `ConfigurableModuleBuilder` або explicit dynamic module.
3. Оновити:
   - `apps/api/src/api.module.ts`;
   - `apps/worker/src/worker.module.ts`;
   - `apps/cron/src/cron.module.ts`;
   - `apps/migrations/src/main.ts` за потреби.
4. Оновити `README.md`, `EXAMPLES.md`, `MODULES_OVERVIEW_NON_TECH.md`.
5. Додати bootstrap fixtures з мінімальним env для кожного entrypoint.

## Приклад public contract

`libs/infrastructure/src/mail/mail-module.options.ts`

```ts
export interface MailModuleOptions {
  driver: 'null' | 'smtp';
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
  };
}
```

`libs/infrastructure/src/mail/mail.module.ts`

```ts
const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<MailModuleOptions>()
    .setClassMethodName('forRoot')
    .setFactoryMethodName('forRootAsync')
    .build();

@Module({
  providers: [
    {
      provide: TOKENS.EmailGateway,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: MailModuleOptions) =>
        options.driver === 'smtp' ? createSmtpAdapter(options.smtp) : createNullMailAdapter(),
    },
  ],
  exports: [TOKENS.EmailGateway],
})
export class MailModule extends ConfigurableModuleClass {}
```

Не копіювати цей fragment буквально, якщо adapters мають Nest-managed dependencies. Головний acceptance criterion: inactive adapter не входить до provider graph.

---

# 6. Серіалізувати паралельні запуски PostgreSQL migrations

**ID:** `P2-01`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `apps/migrations/src/main.ts`
- runner викликає Drizzle `migrate()` без PostgreSQL advisory lock.
- поточна Drizzle migration implementation не додає global mutex навколо всього read/apply flow.

## Що зараз не так

Два migration processes можуть одночасно прочитати однаковий migration journal state і почати застосовувати однакові DDL/DML migrations.

## Що потрібно змінити

1. Отримати dedicated `PoolClient`.
2. Отримати `pg_advisory_lock` з постійним application-specific key.
3. Виконати migration на тому самому connection.
4. Завжди unlock/release у `finally`.
5. Додати configurable lock timeout і зрозумілий exit error.
6. Не покладатися лише на Docker Compose `depends_on` або один replica.

## Точні зміни

- `apps/migrations/src/main.ts`
- за потреби окремий `apps/migrations/src/migration-lock.ts`
- `README.md`/`DOCKER_PRODUCTION.md`

Acceptance criteria визначені у `V-06`.

---

# 7. Узгодити QueueJobRegistry з усіма зареєстрованими BullMQ queues

**ID:** `P2-02`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `libs/contracts/src/queues/queue-names.ts` оголошує 9 queue names.
- `libs/contracts/src/queues/queue-gateway.ts` має typed `QueueJobRegistry` лише для `email` та `outbox`.
- `libs/infrastructure/src/bullmq/bullmq.module.ts` реєструє всі queues.
- `libs/infrastructure/src/bullmq/queue.gateway.ts` hard-code injects усі queue instances.

## Що зараз не так

Runtime registry і public typed contract розходяться. Більшість зареєстрованих queues неможливо використати через `IQueueGateway` без редагування concrete adapter internals.

## Що потрібно змінити

1. Обрати один extension model:
   - augmentable TypeScript registry;
   - queue definitions у dynamic module options;
   - окремі typed producer tokens per queue.
2. Не hard-code inject дев’яти queues у constructor adapter.
3. Будувати queue map із explicit definitions.
4. Зробити queue registration entrypoint-specific.
5. Оновити docs разом із `P3-04`.

---

# 8. Реалізувати справжню semantics forgetByPattern()

**ID:** `P2-03`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `libs/contracts/src/cache/cache-gateway.ts`
- `libs/infrastructure/src/cache/redis-cache.gateway.ts`

Поточна implementation виконує:

```ts
await this.redis.del(this.prefix + pattern);
```

Redis `DEL app:user:*` видаляє literal key, а не keys, matching wildcard.

## Що зараз не так

Метод із pattern semantics фактично є alias для `del()`. Cache invalidation silently не спрацьовує.

## Що потрібно змінити

Обрати один варіант:

1. cursor-based `SCAN MATCH` + batched `UNLINK`/`DEL`; або
2. видалити `forgetByPattern()` із contract і перейти на versioned namespaces/tags.

Не використовувати blocking `KEYS` у production.

## Точні зміни

- `libs/infrastructure/src/redis/redis.service.ts`
- `libs/infrastructure/src/cache/redis-cache.gateway.ts`
- `libs/contracts/src/cache/cache-gateway.ts`, якщо semantics змінюється
- `README.md`

---

# 9. Не повертати Outbox event у retry, поки timeouted handler продовжує side effect

**ID:** `P2-04`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`
- symbol: `publishEventWithLease()`

`Promise.race()` reject-иться по timeout, але `domainEventRouter.route()` не скасовується. Після цього `markFailed()` може повернути event у `pending`, а lease heartbeat уже зупиняється.

## Що зараз не так

Перший handler може продовжувати зовнішній side effect, поки наступний delivery уже обробляє той самий event.

## Що потрібно змінити

Обрати і задокументувати один protocol:

1. передавати `AbortSignal` у router/handler contracts і вимагати cooperative cancellation;
2. не переводити event у retry, доки original handler Promise реально не settle;
3. матеріалізувати per-handler durable deliveries з окремим idempotency key.

Додатково:

- очистити timeout timer після раннього успіху;
- не заявляти exactly-once;
- зберегти renewable lease;
- ownership loss не маскувати як звичайний handler error.

## Точні зміни

- `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`
- `libs/contracts/src/events/domain-event-router.ts`
- event handler contracts/implementations
- Outbox documentation

---

# 10. Додати bounded deadlines для readiness checks

**ID:** `P2-05`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `libs/infrastructure/src/health/health.service.ts`
- Redis/BullMQ runtime clients мають reconnect-oriented behavior.
- PostgreSQL pool не має достатньо явних health-specific connection/query deadlines.

## Що зараз не так

Readiness request може чекати dependency reconnect довше за probe budget або невизначено довго, замість швидкого структурованого `503`.

## Що потрібно змінити

1. Додати configurable timeout для кожного check.
2. Використати library-native timeout або bounded `Promise.race`/AbortSignal.
3. Для health probe не використовувати infinite retries/offline queue.
4. Додати PostgreSQL connection/query timeout.
5. Гарантувати завершення readiness response у фіксований deadline.
6. Не плутати liveness і readiness semantics.

## Точні зміни

- `libs/infrastructure/src/health/health.service.ts`
- Redis/BullMQ connection options
- `libs/infrastructure/src/database/drizzle/drizzle.module.ts`
- env/module options contracts
- deployment probe configuration

---

# 11. Перевіряти актуальний User під час refresh/session authorization

**ID:** `P2-06`  
**Severity:** Medium  
**Classification:** Architectural/security risk

## Доказ

- `libs/infrastructure/src/auth/jwt-auth-token.service.ts`
- `libs/infrastructure/src/auth/session-auth-token.service.ts`
- `libs/application/src/use-cases/auth/refresh-auth-session.usecase.ts`

JWT refresh відтворює `CurrentUser` зі старих claims без repository lookup. Session mode повертає stored user/roles snapshot до завершення TTL.

## Що зараз не так

Role revoke, email/role update або user disable можуть не впливати на активну refresh family/session. JWT refresh може нескінченно продовжувати новий TTL зі старими authorization claims.

## Що потрібно змінити

1. Refresh use case повинен завантажувати current auth subject через port.
2. Перевіряти, що user існує та active.
3. Використовувати актуальні roles/claims.
4. Додати absolute refresh-family lifetime.
5. Додати `authVersion`/`sessionVersion` або еквівалентний revoke mechanism.
6. Інвалідувати sessions/tokens після password, roles або status changes.
7. Не переносити repository dependency всередину generic token codec, якщо це порушує boundary; orchestration повинна залишатися в Application.

## Точні зміни

- auth use cases/contracts
- `IUserRepository` або окремий `IAuthSubjectRepository`
- JWT/session records/claims
- auth services
- migration/schema, якщо додається version field
- auth documentation

---

# 12. Обробляти втрату ownership під час завершення email execution

**ID:** `P2-07`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `apps/worker/src/processors/email.processor.ts`
- `IJobExecutionStore.complete()` повертає `Promise<boolean>`.
- результат `complete()` ігнорується.

## Що зараз не так

`false` означає, що worker більше не володіє execution key. Проте BullMQ job завершується успішно, ніби completed marker гарантовано записаний.

```text
email side effect успішний
complete(...) -> false
job -> completed
completed idempotency marker відсутній
наступний duplicate delivery може повторити send
```

## Що потрібно змінити

1. Явно перевіряти результат `complete()`.
2. Логувати ownership loss з `jobId` та idempotency key.
3. Визначити policy: fail job, quarantine/manual review або provider-level idempotency reconciliation.
4. Не release key після успішного side effect, якщо ownership уже втрачено.
5. Документувати crash window між external side effect і local completion marker.

Це не скасовує at-least-once semantics і не створює exactly-once гарантію.

---

# 13. Прибрати другий process.env configuration path для Outbox concurrency

**ID:** `P2-08`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

- `apps/worker/src/processors/outbox.processor.ts`
- `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`

`OutboxProcessorModule` отримує options через Nest DI, але decorator:

```ts
@Processor(QUEUES.OUTBOX, buildOutboxProcessorDecoratorOptions())
```

повторно читає `process.env` під час module evaluation. Invalid env мовчки повертає defaults.

## Що зараз не так

Один processor має два незалежні configuration paths:

```text
DI options -> batch, TTL, retry, heartbeat
process.env -> BullMQ concurrency
```

Programmatic `forRoot({ concurrency: 8 })` може фактично запустити processor із concurrency `1`.

## Що потрібно змінити

1. Не читати `process.env` у decorator helper.
2. Зробити concurrency частиною одного composition contract.
3. Реєструвати worker/processor через dynamic BullMQ configuration або інший Nest-supported single-source mechanism.
4. Invalid configuration повинна fail-fast, а не мовчки використовувати default.

---

# 14. Зробити Redis startup probe component-aware

**ID:** `P2-09`  
**Severity:** Low/Medium  
**Classification:** Confirmed defect

## Доказ

- `libs/infrastructure/src/redis/assert-redis-available.ts`

Reusable utility завжди логує prefix:

```text
[worker-startup]
```

але викликається API, Worker і Cron entrypoints.

## Що потрібно змінити

1. Передавати `componentName` або logger у probe options.
2. Не hard-code назву одного entrypoint у reusable utility.
3. Не логувати secrets/Redis password.
4. Узгодити structured startup log format.

---

# 15. Усунути 8 high vulnerabilities у production dependency graph

**ID:** `P2-10`  
**Severity:** Medium  
**Classification:** Confirmed production-readiness defect

## Доказ

Поточний результат:

```text
npm audit --omit=dev --json
high: 8
critical: 0
```

Affected graph включає Nest platform/core dependency chain та direct/transitive packages, зокрема Multer/Nodemailer related advisories.

## Що потрібно змінити

1. Визначити direct dependency, fixed version і runtime reachability кожної advisory.
2. Оновити direct dependencies та regenerate `package-lock.json`.
3. Не використовувати blind `npm audit fix --force`.
4. Додати CI SCA/audit gate.
5. Для тимчасово accepted findings створити allowlist з:
   - advisory ID;
   - обґрунтуванням;
   - owner;
   - expiry date.
6. Повторити build/typecheck/lint/runtime smoke після upgrade.

Acceptance criteria:

```text
critical = 0
high = 0
```

або explicit approved time-bounded exception для недоступного upstream fix.

---

# 16. Не включати .env та credential-like values у starter distribution

**ID:** `P2-11`  
**Severity:** Medium  
**Classification:** Confirmed defect

## Доказ

У корені distribution archive присутній `.env` з non-empty credential-like values. `.gitignore` не захищає вручну сформований ZIP/archive.

## Що зараз не так

Starter artifact передає runtime configuration/secrets разом із кодом.

## Що потрібно змінити

1. Видалити `.env` із distribution artifact.
2. Не видаляти `.env.example`.
3. Rotate values, якщо вони коли-небудь використовувалися поза локальним disposable environment.
4. Створювати archive через `git archive` або explicit allow/exclude list.
5. Додати secret scanner у CI/release flow.
6. Додати check, що archive не містить:
   - `.env`;
   - private keys;
   - cloud credentials;
   - access tokens;
   - database dumps.

Не копіювати secret values у implementation/verification reports.

---

# 17. Узгодити Node engines з фактичними dependency requirements

**ID:** `P3-01`  
**Severity:** Low  
**Classification:** Confirmed compatibility defect

## Доказ

- `package.json`: `node >=22 <25`.
- installed `lint-staged@17.0.7` вимагає `node >=22.22.1`.
- Node `22.16.0` формально дозволений starter, але npm повертає `EBADENGINE` warning.

## Що потрібно змінити

Обрати один варіант:

1. підняти engines до `>=22.22.1 <25`; або
2. pin/downgrade `lint-staged` до release, сумісного з усім заявленим Node 22 range.

CI matrix повинна перевіряти мінімальну заявлену версію.

---

# 18. Не заявляти users feature як реалізовану, якщо це лише приклад

**ID:** `P3-02`  
**Severity:** Low  
**Classification:** Documentation mismatch

## Документація заявляє

`README.md` та `EXAMPLES.md` описують users controller/use cases як фактичну структуру starter.

## Фактична реалізація

У baseline є auth feature, але немає заявлених `create-user`, `get-user-by-id`, `deposit-user-balance` use cases та `users.controller.ts`.

## Потрібно змінити

Обрати один варіант:

1. реалізувати повний users example; або
2. чітко позначити sections як hypothetical extension/tutorial, а не existing feature.

Не додавати business-specific balance behavior у reusable starter лише заради відповідності старому прикладу без окремого рішення.

---

# 19. Документувати чотири entrypoint, включно з Migrations

**ID:** `P3-03`  
**Severity:** Low  
**Classification:** Documentation mismatch

## Фактична реалізація

`nest-cli.json` і `package.json` мають production entrypoints:

1. API;
2. Worker;
3. Cron;
4. Migrations.

## Що потрібно змінити

- виправити README/package description, де заявлено лише три entrypoints;
- описати build/start command, dependency set і deployment role Migrations;
- не описувати Migrations як long-running service;
- додати migration ordering та advisory lock requirements.

---

# 20. Виправити інструкцію додавання BullMQ queue/job

**ID:** `P3-04`  
**Severity:** Low  
**Classification:** Documentation mismatch

## Що зараз не так

Поточний example створює враження, що достатньо додати queue name і processor. Фактично потрібно узгодити:

- queue name;
- typed payload registry;
- queue registration;
- producer token/gateway;
- processor/provider registration;
- target entrypoint imports;
- retry/backoff/idempotency policy.

## Потрібно змінити

Після `P1-05` і `P2-02` переписати `EXAMPLES.md` під фактичний public contract. Example повинен компілюватися без редагування private internals adapter.

---

# 21. Узгодити cache документацію з реальною pattern semantics

**ID:** `P3-05`  
**Severity:** Low  
**Classification:** Documentation mismatch

README заявляє `forgetByPattern()` як робочий cache flow, але поточний adapter виконує literal `DEL`.

Після `P2-03` документація повинна описувати обрану semantics:

- `SCAN MATCH + UNLINK`;
- versioned namespaces/tags;
- або відсутність pattern invalidation у public contract.

Також документувати performance/atomicity limitations scan-based invalidation.

---

# 22. Уточнити гарантії idempotency, at-least-once та portability

**ID:** `P3-06`  
**Severity:** Low  
**Classification:** Documentation mismatch

## Idempotency/Outbox

Не заявляти exactly-once side effects. Навіть після lease/heartbeat fixes існує crash window:

```text
external side effect succeeded
process crashed before local completion marker
retry repeats delivery
```

Правильні гарантії:

- transport/outbox — at-least-once;
- handlers мають бути idempotent;
- downstream provider idempotency key потрібен для зовнішнього side effect;
- exactly-once можливий лише зі спільною transaction boundary або downstream support.

## Portability

Після `P1-05` для кожного module документувати:

- public options;
- sync/async registration;
- exported tokens;
- peer modules;
- required schema/migrations;
- lifecycle/shutdown;
- active driver behavior;
- entrypoint examples.

---

# 23. Повторити clean install, build, typecheck, lint та production audit

**ID:** `V-01`

Виконати у clean CI environment:

```bash
rm -rf node_modules dist
npm ci
npm run build:api
npm run build:worker
npm run build:cron
npm run build:migrations
npm run build
npx tsc --noEmit
npm run lint
npm audit --omit=dev
```

## Acceptance criteria

- усі individual builds завершуються code 0;
- aggregate `npm run build` завершується code 0 і не зависає;
- typecheck/lint завершуються code 0;
- мінімальна Node version із `engines` не повертає `EBADENGINE`;
- production audit не має unapproved critical/high findings.

---

# 24. Перевірити bootstrap усіх чотирьох entrypoint з мінімальними env

**ID:** `V-02`

Створити окремі env fixtures:

```text
api.env
worker.env
cron.env
migrations.env
```

Перевірити:

- API не вимагає worker-only config;
- Worker не вимагає API cookie/CORS config;
- Cron не вимагає JWT/SMTP/S3 config, якщо modules не імпортовані;
- Migrations не вимагає Redis/JWT/Mail;
- expected Redis/PostgreSQL connection error відокремлений від DI/config error;
- усі process завершуються graceful/fail-fast відповідно до entrypoint role.

---

# 25. Перевірити LocalStorage traversal negative cases

**ID:** `V-03`

Перевірити щонайменше:

```text
../outside.txt
../../outside.txt
/absolute/path
C:\absolute\path
folder/../../../outside.txt
folder\..\..\outside.txt
NUL-containing key
empty key
valid/nested/file.txt
```

Acceptance criteria:

- invalid key відхиляється до filesystem operation;
- жоден файл поза root не створено/прочитано/видалено;
- valid nested key працює;
- behavior однаковий на Linux і Windows path semantics, наскільки це можливо у test matrix.

---

# 26. Перевірити Cron після transient Redis/BullMQ failure

**ID:** `V-04`

Scenario:

1. Запустити Cron з fake/real dependency.
2. Перший tick повертає rejected Promise.
3. Перевірити, що process залишається живим.
4. Наступний tick успішно enqueue-ить job.
5. Перевірити structured error log.
6. Перевірити, що ticks не перекриваються.

Acceptance criteria:

```text
process exit code != 1 через transient tick failure
subsequent tick executed successfully
```

---

# 27. Перевірити production JWT secret policy

**ID:** `V-05`

Negative fixtures:

- one-character secret;
- whitespace-only secret;
- default placeholder;
- equal access/refresh secrets;
- missing one secret.

Positive fixture:

- два різні securely generated secrets достатньої довжини.

Acceptance criteria:

- negative fixtures fail з field-specific message;
- positive fixture passes;
- development mode може мати окрему documented policy, але production не приймає defaults.

---

# 28. Перевірити parallel migration startup

**ID:** `V-06`

Запустити два migration processes одночасно проти чистої PostgreSQL database.

Acceptance criteria:

- лише один process виконує migration section;
- другий чекає або завершується з контрольованою lock-timeout помилкою;
- migration journal не дублюється;
- schema не залишається partially migrated;
- lock звільняється після success і failure.

---

# 29. Перевірити Outbox timeout, lease та duplicate-side-effect сценарії

**ID:** `V-07`

Scenario A — handler довший за timeout:

1. Handler side effect блокується.
2. Timeout спрацьовує.
3. Переконатися, що event не стає доступним другому owner, поки original handler реально виконується, або handler отримує/поважає cancellation.

Scenario B — handler довший за lease TTL:

1. Два processor instances.
2. Handler latency більша за початковий lock TTL.
3. Heartbeat продовжує ownership.
4. Side effect виконується не паралельно.

Scenario C — crash window:

1. External side effect succeeded.
2. Process падає до `markProcessed()`.
3. Retry behavior відповідає documented at-least-once semantics.

---

# 30. Перевірити readiness deadline під час dependency outage

**ID:** `V-08`

Для Redis, PostgreSQL та BullMQ окремо:

1. Підняти API.
2. Зробити dependency unavailable/hanging.
3. Викликати readiness endpoint.
4. Заміряти duration.

Acceptance criteria:

- response повертається в configured deadline;
- status — degraded/unready, а не hanging connection;
- liveness залишається окремою від readiness;
- repeated probes не створюють uncontrolled connection/request accumulation.

---

# 31. Перевірити role revoke, user disable та authVersion flow

**ID:** `V-09`

Перевірити JWT і Session modes:

1. Login user із role `admin`.
2. Забрати role або disable user.
3. Спробувати access verification/refresh/session use.
4. Змінити password/authVersion.
5. Повторити refresh.

Acceptance criteria:

- disabled user не отримує нову auth session;
- revoked role не відновлюється зі старого refresh token;
- старі sessions/tokens відхиляються відповідно до documented policy;
- refresh family має absolute lifetime.

---

# 32. Перевірити QueueGateway для всіх заявлених queues

**ID:** `V-10`

Для кожної queue, яка залишається у public contract:

- payload type доступний compile-time;
- producer може enqueue без редагування concrete gateway;
- queue зареєстрована лише у потрібному entrypoint;
- processor registration explicit;
- unknown queue/job не компілюється або fail-fast на bootstrap.

Не вимагати підтримки placeholder queue, якщо її видалено з public contract як невикористану.

---

# 33. Перевірити pattern cache invalidation

**ID:** `V-11`

Створити keys:

```text
app:user:1
app:user:2
app:order:1
```

Викликати invalidation для `user:*`.

Acceptance criteria:

- обидва user keys видалені;
- order key залишився;
- implementation не використовує blocking `KEYS`;
- large keyspace обробляється batches/cursor;
- prefix застосовується рівно один раз.

---

# 34. Перевірити graceful shutdown активних BullMQ jobs

**ID:** `V-12`

Scenario:

1. Запустити довгу email/outbox job.
2. Надіслати SIGTERM worker container/process.
3. Перевірити behavior протягом configured grace period.

Acceptance criteria:

- worker припиняє брати нові jobs;
- active job завершується або безпечно повертається для retry;
- Redis/PostgreSQL connections закриваються;
- heartbeat timers очищаються;
- немає duplicate side effect через premature lease expiry.

---

# 35. Перевірити Docker development і production flows

**ID:** `V-13`

Перевірити:

```bash
docker compose up --build

docker build --target runtime -t nest-starter:review .
```

Acceptance criteria:

- migrations files доступні runtime image;
- `start:prod:*` paths відповідають build output;
- API, Worker і Cron запускаються окремими containers;
- Migrations запускається як one-shot job;
- service ordering не замінює application-level retry/lock;
- health/readiness відображають dependency state;
- production image не містить `.env`, source secrets та зайві development artifacts.

---

# 36. Перевірити release artifact на secrets та зайві файли

**ID:** `V-14`

Перед публікацією ZIP/container/npm artifact:

1. Розпакувати artifact у clean directory.
2. Запустити secret scanner.
3. Перевірити explicit forbidden file list.
4. Порівняти artifact manifest із allowlist.

Acceptance criteria:

- немає `.env`;
- немає private keys/tokens/passwords;
- є `.env.example` без реальних credentials;
- є migrations і runtime-required templates;
- немає `node_modules`, local DB dumps, editor temp files або agent reports, якщо вони не частина distribution contract.

---

# Вже реалізовано — не виконувати повторно

## R-01. Renewable email execution lease

Поточний baseline уже має:

- ownership token у `IJobExecutionStore.acquire()`;
- `extend()` heartbeat;
- compare-and-set `complete()`;
- compare-and-delete `release()`;
- configurable lease/heartbeat values у `EmailProcessor`.

Не повертати стару fixed-TTL implementation. Відкритою залишається лише `P2-07`: обробка `complete() === false` та crash-window policy.

## R-02. Renewable Outbox lease

Поточний `DrizzleOutboxProcessor` уже має:

- `lockedBy` ownership;
- `renewEventLease()`;
- heartbeat interval;
- conditional `markProcessed()`/`markFailed()`.

Не видаляти heartbeat. Відкритою залишається `P2-04`: timeout не скасовує original handler.

## R-03. Lint

Поточний baseline проходить:

```text
npm run lint
exit code: 0
```

Старий backlog item про `require-await` у `NullMailAdapter` більше не є відкритим.

## R-04. Individual entrypoint compilation

Окремі builds API, Worker, Cron і Migrations проходили під час рев’ю. Aggregate build потрібно повторити у clean CI через `V-01`, оскільки в review environment chain не завершився в доступному runtime window.

---

# Перевірки, виконані для актуалізації backlog

## Lint

```text
Команда: npm run lint
Результат: code 0
Висновок: окремий lint defect із попередньої версії backlog закритий.
```

## Production dependency audit

```text
Команда: npm audit --omit=dev --json
Результат: code 1
Vulnerabilities: 8 high, 0 critical
Висновок: P2-10 залишається відкритим.
```

## Build

```text
Individual entrypoint builds: підтверджено успішну компіляцію під час повного рев’ю.
Aggregate npm run build: не підтверджено остаточно у поточному середовищі; command chain не завершився до tool timeout.
```

## Runtime infrastructure

```text
Redis/PostgreSQL/SMTP/S3/Docker integration не підтверджена повністю через відсутність відповідних services/daemon у review environment.
Це не дозволяє закривати verification backlog лише на основі build/typecheck.
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

Не редагувати цей backlog, щоб мовчки заявити про завершення задачі. Для закриття ID потрібно:

1. implementation report;
2. verification report;
3. commit/patch reference;
4. acceptance decision.

Для кожного ID AI-агент повинен створити:

```text
.agent/plans/<ID>-plan.md
.agent/reports/<ID>-implementation.md
.agent/reports/<ID>-verification.md
```

У verification report обов’язково вказати:

```text
Команда/сценарій:
Очікуваний результат:
Фактичний результат:
Exit code:
Доказ:
Непідтверджені частини:
```
