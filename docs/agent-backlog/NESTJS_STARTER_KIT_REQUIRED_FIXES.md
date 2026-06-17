# NestJS Starter Kit — обов’язкові виправлення

Цей документ містить консолідований перелік проблем, виявлених під час архітектурного та технічного рев’ю NestJS Starter Kit.

Документ не містить переліку переваг проєкту та не враховує відсутність тестів, Prettier або суто форматувальні lint-помилки.

## Пріоритети

- **P0** — виправити до будь-якого production-використання.
- **P1** — виправити до позиціонування starter kit як незалежного та переносного фундаменту.
- **P2** — виправити для production readiness, передбачуваної експлуатації та коректної документації.

---

# P0. Runtime, дублювання side effects та цілісність обробки

## 1. Зробити idempotency email worker атомарною

**Критичність:** High  
**Класифікація:** Confirmed defect  
**Пріоритет:** P0

### Доказ

Релевантні компоненти:

- `apps/worker/src/processors/email.processor.ts`;
- `IJobExecutionStore`;
- Redis-реалізація `JobExecutionStore`.

Поточний flow:

```text
isCompleted(idempotencyKey)
  -> mail.send()
    -> markCompleted(idempotencyKey)
```

Перевірка стану і фіксація завершення виконуються окремими Redis-операціями, а зовнішній side effect розташований між ними.

### Що не так

Два worker-процеси можуть одночасно пройти перевірку `isCompleted()`, після чого обидва відправлять лист.

```text
Worker A -> isCompleted = false
Worker B -> isCompleted = false
Worker A -> send email
Worker B -> send email
Worker A -> markCompleted
Worker B -> markCompleted
```

Поточний механізм захищає лише від повторного запуску вже завершеної job, але не захищає від конкурентного виконання однієї idempotency key.

### Наслідки

- повторне відправлення email;
- дублювання notification side effects;
- некоректна поведінка при at-least-once delivery;
- особливо високий ризик при повторній доставці Outbox event або BullMQ retry.

### Що потрібно змінити

Замінити контракт із двох незалежних операцій `isCompleted()` / `markCompleted()` на атомарний execution claim.

Рекомендований контракт:

```ts
export interface IJobExecutionStore {
  acquire(key: string, ttlSeconds: number): Promise<string | null>;

  complete(
    key: string,
    ownershipToken: string,
    ttlSeconds: number,
  ): Promise<boolean>;

  release(key: string, ownershipToken: string): Promise<void>;
}
```

### Точні зміни

1. Оновити `libs/contracts/src/idempotency/job-execution-store.ts`.
2. У Redis adapter реалізувати claim через:

```text
SET execution-key ownership-token NX EX ttl
```

3. Для `complete()` і `release()` використати compare-and-set Lua script, який перевіряє ownership token.
4. Оновити `apps/worker/src/processors/email.processor.ts`.
5. Перед відправленням email worker повинен отримати ownership token.
6. Після успішної відправки worker повинен атомарно перевести execution marker у completed state.
7. Після помилки worker повинен звільнити claim лише за умови, що він досі є власником.
8. Execution TTL повинен покривати максимальний час виконання job або продовжуватися heartbeat-механізмом.
9. Описати failure model у `README.md` та `EXAMPLES.md`.

### Цільовий flow

```text
acquire(idempotencyKey)
  -> ownership token отримано?
    -> ні: завершити без side effect
    -> так:
       -> mail.send()
       -> complete(idempotencyKey, ownershipToken)
```

### Критерії приймання

- Два паралельні workers не можуть одночасно виконати email side effect для однієї idempotency key.
- Worker без актуального ownership token не може завершити або звільнити чужий claim.
- Retry після помилки можливий.
- Completed execution не запускається повторно протягом configured retention period.

---

## 2. Усунути завершення Outbox lease під час активної обробки batch

**Критичність:** Medium  
**Класифікація:** Confirmed defect  
**Пріоритет:** P0

### Доказ

Релевантний файл:

- `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`.

Поточні константи:

```ts
const BATCH_SIZE = 50;
const LOCK_TTL_MS = 5 * 60 * 1000;
```

Події після claim обробляються послідовно:

```ts
for (const event of events) {
  await this.publishEvent(event);
  await this.markProcessed(...);
}
```

Продовження lease або оновлення `lockedAt` під час виконання відсутнє.

### Що не так

Lease усіх подій починається в момент отримання batch. Якщо обробка batch триває довше за `LOCK_TTL_MS`, інший worker може повторно claim-ити події, які перший worker ще обробляє.

Приклад:

```text
50 подій × 8 секунд = 400 секунд
LOCK_TTL = 300 секунд
```

Останні події стають stale до завершення першого worker.

### Наслідки

- паралельна публікація однієї події;
- дублювання side effects;
- втрата ownership після фактичного publish;
- повторний retry події, яка вже була опублікована;
- нестабільна поведінка при кількох Outbox workers.

### Що потрібно змінити

Реалізувати один із безпечних варіантів:

1. claim невеликими batch;
2. claim наступної події лише після завершення поточної;
3. heartbeat із продовженням lease;
4. lease-until, який регулярно оновлюється owner-процесом;
5. bounded concurrency з heartbeat для всіх активних records.

Рекомендований підхід:

```text
claim small batch
  -> process with bounded concurrency
  -> periodically renew lease for active records
  -> publish
  -> mark processed with ownership check
```

### Точні зміни

1. Оновити `DrizzleOutboxProcessor`.
2. Додати метод продовження lease в Outbox repository/adapter.
3. Перевіряти ownership token або worker identifier у:
   - `renewLease`;
   - `markProcessed`;
   - `markFailed`.
4. При втраті ownership не дозволяти старому worker змінювати record.
5. Винести batch size і lease TTL у typed options.
6. Узгодити poll interval, execution timeout і lease TTL.

### Критерії приймання

- Активно оброблювана подія не може бути повторно claimed іншим worker.
- `markProcessed` виконується лише актуальним owner.
- Stale recovery працює для worker, який справді перестав оновлювати lease.
- Кілька Outbox workers можуть безпечно працювати паралельно.

---

# P1. Переносимість та незалежна конфігурація модулів

## 3. Додати typed `forRoot` / `forRootAsync` contracts для reusable infrastructure modules

**Критичність:** High  
**Класифікація:** Architectural risk  
**Пріоритет:** P1

### Доказ

Релевантні модулі:

- `RedisModule`;
- `DrizzleModule`;
- `InfrastructureBullMqModule`;
- `AuthModule`;
- `MailModule`;
- `StorageModule`;
- `RateLimiterModule`;
- `LocksModule`.

Типовий dependency flow:

```text
Feature infrastructure module
  -> InfrastructureConfigModule
    -> global ConfigModule.forRoot()
      -> AppConfigService
        -> process.env
```

### Що не так

Для перенесення окремого модуля недостатньо перенести його каталог. Разом із ним потрібно переносити:

- `InfrastructureConfigModule`;
- `AppConfigService`;
- загальну env schema;
- спільні назви env variables;
- іноді logger/config infrastructure;
- global module assumptions.

Таким чином модулі не мають незалежного public configuration contract.

### Наслідки

- модуль неможливо підключити в інший NestJS-проєкт без перенесення значної частини starter kit;
- інтегратор залежить від внутрішньої config implementation;
- складно використовувати власний `ConfigService`;
- складно створювати декілька connection instances;
- неможливо замінити внутрішній adapter через module options;
- заявлена переносимість модулів не досягається повністю.

### Що потрібно змінити

Кожен reusable module повинен мати власні options types і options token.

Приклад для Redis:

```ts
export interface RedisModuleOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  connectTimeoutMs?: number;
}

export interface RedisModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: FactoryProvider['inject'];
  useFactory: (
    ...args: unknown[]
  ) => RedisModuleOptions | Promise<RedisModuleOptions>;
}
```

Public API:

```ts
RedisModule.forRoot(options);
RedisModule.forRootAsync(options);
```

### Модулі, які потрібно оновити

#### Redis

- `redis/redis.module.ts`;
- додати `REDIS_MODULE_OPTIONS`;
- lifecycle adapter повинен залежати від options token, а не від `AppConfigService`.

#### PostgreSQL / Drizzle

- `database/drizzle/drizzle.module.ts`;
- додати `DRIZZLE_MODULE_OPTIONS`;
- options: connection string, pool limits, timeouts, schema, migration behavior.

#### BullMQ

- `bullmq/bullmq.module.ts`;
- додати root connection options;
- окремо реалізувати `registerQueues()`.

#### Mail

- `mail/mail.module.ts`;
- options для SMTP/provider adapter, sender identity, timeout, retries.

#### Storage

- `storage/storage.module.ts`;
- options для provider, endpoint, bucket, region, credentials, path style.

#### Auth

- `auth/auth.module.ts`;
- typed driver configuration;
- provider overrides;
- JWT/session-specific options.

#### Rate limiter

- `rate-limiter/rate-limiter.module.ts`;
- configurable store, prefix, policies, time windows.

#### Locks

- `locks/locks.module.ts`;
- configurable Redis dependency/token, prefix, TTL, heartbeat.

### Правильна роль `InfrastructureConfigModule`

`InfrastructureConfigModule` може залишитися як готовий preset для цього starter kit:

```ts
RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => config.redis(),
});
```

Але reusable modules не повинні самостійно імпортувати його як обов’язкову внутрішню залежність.

### Критерії приймання

- Кожен модуль можна перенести в інший проєкт без `AppConfigService`.
- Кожен модуль підтримує sync і async configuration.
- Можна використовувати стандартний `ConfigService` або власний config provider.
- Можна override-ити concrete adapter через DI.
- Внутрішній код модуля не потрібно редагувати для інтеграції.

---

## 4. Розділити env validation за entrypoint і модулем

**Критичність:** High  
**Класифікація:** Architectural risk  
**Пріоритет:** P1

### Доказ

Релевантний файл:

- `libs/infrastructure/src/config/env.schema.ts`.

Глобальна schema безумовно вимагає, зокрема:

```ts
DATABASE_URL: z.string().url(),
JWT_SECRET: z.string().min(1),
JWT_REFRESH_SECRET: z.string().min(1),
```

`InfrastructureConfigModule` використовується різними composition roots.

### Що не так

Cron або Worker змушені мати env values, які їм не потрібні.

Наприклад, Cron, який використовує Redis, BullMQ та distributed lock, однаково може вимагати:

- PostgreSQL URL;
- JWT secret;
- JWT refresh secret;
- Auth configuration.

Session driver також може вимагати JWT secrets, хоча JWT strategy не використовується.

### Наслідки

- entrypoint отримує зайві production secrets;
- гірша security isolation;
- зайві deployment dependencies;
- складніша конфігурація Kubernetes/Compose;
- окремий entrypoint не може стартувати з мінімально потрібним env;
- модулі залишаються пов’язаними через спільну schema.

### Що потрібно змінити

Розділити validation:

```text
baseEnvSchema
apiEnvSchema
workerEnvSchema
cronEnvSchema
migrationEnvSchema
```

Додатково модулі повинні самостійно валідовувати власні options.

### Auth validation

Використати discriminated union:

```ts
const jwtAuthSchema = z.object({
  AUTH_DRIVER: z.literal('jwt'),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
});

const sessionAuthSchema = z.object({
  AUTH_DRIVER: z.literal('session'),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().positive(),
});
```

### Точні зміни

Оновити:

- `libs/infrastructure/src/config/env.schema.ts`;
- `libs/infrastructure/src/config/infrastructure-config.module.ts`;
- `apps/api/src/api.module.ts`;
- `apps/worker/src/worker.module.ts`;
- `apps/cron/src/cron.module.ts`;
- migrations entrypoint/config.

### Критерії приймання

- API стартує лише з API-required variables.
- Worker не вимагає JWT secrets, якщо Auth не використовується.
- Cron не вимагає PostgreSQL або SMTP, якщо ці залежності не імпортовані.
- Session mode не вимагає JWT configuration.
- Відсутня конфігурація конкретного модуля виявляється під час його registration/bootstrap.

---

## 5. Зробити BullMQ registration явною для кожного composition root

**Критичність:** Medium  
**Класифікація:** Architectural risk  
**Пріоритет:** P1

### Доказ

`InfrastructureBullMqModule` реєструє всі черги через загальний список:

```ts
BullModule.registerQueue(
  ...Object.values(QUEUES).map((name) => ({ name })),
)
```

`BullQueueGateway` залежить від фіксованого набору всіх queue providers.

### Що не так

Кожен entrypoint реєструє черги, які не використовує.

Наприклад:

```text
CronModule
  -> InfrastructureBullMqModule
    -> default
    -> email
    -> events
    -> outbox
    -> notifications
    -> integrations
    -> analytics
    -> files
    -> maintenance
```

Cron фактично може використовувати лише Outbox queue.

### Наслідки

- composition root не є мінімальним;
- нова черга автоматично потрапляє в усі entrypoints;
- зайві providers/connections;
- складніше визначити реальні runtime dependencies;
- гірша переносимість QueueModule.

### Що потрібно змінити

Розділити connection registration і queue registration:

```ts
InfrastructureBullMqModule.forRootAsync({ ... });

InfrastructureBullMqModule.registerQueues([
  QUEUES.OUTBOX,
]);
```

Для Worker:

```ts
InfrastructureBullMqModule.registerQueues([
  QUEUES.OUTBOX,
  QUEUES.EMAIL,
]);
```

### Додатково

`BullQueueGateway` не повинен constructor-inject-ити всі відомі черги.

Можливі рішення:

- queue registry;
- named gateway per queue;
- dynamic providers;
- `QueueProducer<TPayload>` на конкретну queue.

### Критерії приймання

- Cron реєструє лише потрібні йому черги.
- Worker реєструє лише черги з producers/processors, які він використовує.
- API не створює consumer processors.
- Додавання нової queue не змінює runtime composition інших entrypoints автоматично.

---

## 6. AuthModule повинен створювати лише вибрану strategy

**Критичність:** Medium  
**Класифікація:** Architectural risk  
**Пріоритет:** P1

### Доказ

У `libs/infrastructure/src/auth/auth.module.ts` одночасно реєструються:

- `RedisSessionStore`;
- `RedisJwtTokenStore`;
- `JwtAuthTokenService`;
- `SessionAuthTokenService`;
- JWT-related module/providers.

Після створення обох implementations factory лише вибирає одну за `AUTH_DRIVER`.

### Що не так

JWT і Session infrastructure створюються одночасно незалежно від обраної strategy.

### Наслідки

- session mode залежить від JWT configuration;
- JWT mode створює непотрібні session providers;
- зайві secrets і adapters;
- складно додати custom auth strategy;
- інтегратор повинен редагувати internals для provider replacement.

### Що потрібно змінити

Додати typed dynamic API:

```ts
AuthModule.forRoot({
  driver: 'jwt',
  jwt: {
    accessSecret: '...',
    refreshSecret: '...',
  },
});
```

або:

```ts
AuthModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({ ... }),
});
```

Розділити providers:

```text
JWT_AUTH_PROVIDERS
SESSION_AUTH_PROVIDERS
```

Підключати лише одну колекцію залежно від driver.

Передбачити custom provider override:

```ts
AuthModule.forRoot({
  authTokenService: {
    provide: TOKENS.AuthTokenService,
    useClass: CustomAuthTokenService,
  },
});
```

### Критерії приймання

- JWT mode не створює session providers.
- Session mode не вимагає JWT secrets і не створює JWT providers.
- Можна підключити custom auth adapter без редагування `AuthModule`.
- Public AuthModule API документований.

---

## 7. Прибрати NestJS decorators із Application layer або чесно змінити архітектурний контракт

**Критичність:** Medium  
**Класифікація:** Architectural risk  
**Пріоритет:** P1

### Доказ

Auth use cases імпортують:

```ts
import { Inject, Injectable } from '@nestjs/common';
```

Релевантні use cases:

- `register.usecase.ts`;
- `login.usecase.ts`;
- `logout.usecase.ts`;
- `refresh-auth-session.usecase.ts`;
- `get-current-user.usecase.ts`.

### Що не так

Application layer залежить від NestJS DI metadata.

Use cases не є plain TypeScript classes і не можуть використовуватися без `@nestjs/common`.

### Наслідки

- framework coupling у внутрішньому шарі;
- складніше перенести use cases в CLI або інший framework;
- порушена повна framework independence;
- dependency direction залишається логічно правильною щодо infrastructure, але не щодо framework.

### Варіанти виправлення

#### Рекомендований варіант

Зробити use cases звичайними класами:

```ts
export class RegisterUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly transactionManager: ITransactionManager,
    private readonly outboxWriter: IOutboxWriter,
  ) {}
}
```

Nest registration винести в composition module:

```ts
{
  provide: RegisterUseCase,
  inject: [
    TOKENS.UserRepository,
    TOKENS.PasswordHasher,
    TOKENS.TransactionManager,
    TOKENS.OutboxWriter,
  ],
  useFactory: (
    users: IUserRepository,
    hasher: IPasswordHasher,
    transactions: ITransactionManager,
    outbox: IOutboxWriter,
  ) => new RegisterUseCase(
    users,
    hasher,
    transactions,
    outbox,
  ),
}
```

#### Допустимий альтернативний варіант

Якщо NestJS coupling є свідомим рішенням, документація не повинна стверджувати повну framework independence Application layer.

Потрібно чітко написати:

```text
Domain і Contracts framework-independent.
Application не залежить від infrastructure adapters,
але використовує NestJS DI metadata.
```

### Критерії приймання

- Або `libs/application` не імпортує `@nestjs/*`.
- Або документація точно описує фактичний рівень framework coupling.
- У будь-якому випадку Application не залежить від Redis, Drizzle, BullMQ, HTTP або concrete adapters.

---

## 8. Зменшити використання `@Global()` і зробити provider visibility явною

**Критичність:** Low  
**Класифікація:** Architectural risk  
**Пріоритет:** P1

### Доказ

Глобальними позначені, зокрема:

- `DrizzleModule`;
- `RedisModule`;
- `RepositoriesModule`;
- `TransactionsModule`;
- `AuthModule`;
- `InfrastructureBullMqModule`.

### Що не так

Composition roots можуть виглядати коректними, хоча залежності фактично доступні через global Nest container.

### Наслідки

- приховані dependencies;
- модуль може випадково працювати лише через імпорт global module в іншому місці;
- складніше переносити feature modules;
- складніше перевіряти provider visibility;
- вищий ризик дублювання або неочікуваного sharing instances.

### Що потрібно змінити

1. Переглянути кожен `@Global()`.
2. Залишити global лише для справді process-wide cross-cutting infrastructure, якщо це обґрунтовано.
3. Для решти використовувати явні `imports` / `exports`.
4. Composition module повинен явно імпортувати adapter modules, які надають потрібні tokens.

### Критерії приймання

- Видалення випадкового unrelated module import не ламає DI приховано.
- Dependency chain читається з `imports/providers/exports` конкретного composition root.
- Feature module не залежить від того, що інший module раніше зареєстрував global provider.

---

# P2. Configurability, production readiness та документація

## 9. Винести Outbox runtime constants у typed configuration

**Критичність:** Medium  
**Класифікація:** Production risk  
**Пріоритет:** P2

### Доказ

У `drizzle-outbox-processor.ts` жорстко задані:

```ts
const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 50;
const LOCK_TTL_MS = 5 * 60 * 1000;
```

Backoff також hardcoded:

```ts
Math.min(2 ** attempts * 30, 3600);
```

### Що не так

Параметри неможливо змінити без редагування внутрішньої реалізації.

### Наслідки

- один набір значень використовується для різних проєктів;
- неможливо узгодити lease TTL з реальною тривалістю handlers;
- неможливо змінити batch/concurrency під production load;
- модуль не відповідає вимозі конфігурації без зміни internals.

### Що потрібно змінити

Додати options contract:

```ts
export interface OutboxProcessorOptions {
  batchSize: number;
  maxAttempts: number;
  lockTtlMs: number;
  pollIntervalMs: number;
  concurrency: number;
  retryDelaySeconds: (attempt: number) => number;
}
```

Інжектити options через окремий token, наприклад:

```ts
OUTBOX_PROCESSOR_OPTIONS
```

### Критерії приймання

- Усі runtime policy values задаються composition root.
- Є безпечні defaults.
- Значення валідуються.
- README пояснює взаємозв’язок між batch size, concurrency, handler timeout і lock TTL.

---

## 10. Виправити неправильний log prefix у Redis startup probe

**Критичність:** Low  
**Класифікація:** Confirmed defect  
**Пріоритет:** P2

### Доказ

`assert-redis-available.ts` завжди використовує:

```ts
console.info('[worker-startup] Redis is available ...');
console.error('[worker-startup] Redis connection attempt ...');
```

Функція також викликається API і Cron entrypoints.

### Що не так

API та Cron логують Redis startup як `worker-startup`.

### Наслідки

- неправильна атрибуція production logs;
- складніший пошук startup failures;
- некоректні dashboards/alerts за component label.

### Що потрібно змінити

Передавати component name:

```ts
assertRedisAvailable(options, {
  component: 'api',
});
```

Або прибрати component prefix із reusable utility і логувати на рівні entrypoint.

### Критерії приймання

- API logs мають `api` component.
- Worker logs мають `worker` component.
- Cron logs мають `cron` component.
- Structured logger використовується замість hardcoded console prefix, якщо logger уже є в starter kit.

---

## 11. Усунути documentation mismatch щодо idempotency

**Критичність:** Medium  
**Класифікація:** Documentation mismatch  
**Пріоритет:** P2

### Документація заявляє

Outbox має at-least-once delivery, тому handlers є idempotent.

### Фактична реалізація

Email handler використовує неатомарний flow:

```text
check
  -> side effect
    -> mark completed
```

### Правильна цільова поведінка

Idempotency повинна включати конкурентний execution claim до side effect або provider-level idempotency key.

### Що потрібно змінити

Після виправлення проблеми №1 оновити:

- `README.md`;
- `EXAMPLES.md`;
- за потреби `MODULES_OVERVIEW_NON_TECH.md`.

Документація повинна описувати:

- at-least-once delivery;
- можливість повторної доставки;
- atomic execution claim;
- completed marker retention;
- retry після failure;
- неможливість гарантувати exactly-once без зовнішньої підтримки side-effect provider.

---

## 12. Усунути documentation mismatch щодо незалежного перенесення модулів

**Критичність:** Medium  
**Класифікація:** Documentation mismatch  
**Пріоритет:** P2

### Документація заявляє

Infrastructure modules можна підключати незалежно та переносити між проєктами.

### Фактична реалізація

Модулі мають обов’язкову залежність від спільних:

- `InfrastructureConfigModule`;
- `AppConfigService`;
- global config;
- конкретних env names.

### Правильна цільова поведінка

Кожен reusable module має власний typed registration contract і не залежить від конкретної config implementation.

### Що потрібно змінити

Після реалізації проблеми №3 оновити приклади:

```ts
RedisModule.forRootAsync(...);
DrizzleModule.forRootAsync(...);
MailModule.forRootAsync(...);
AuthModule.forRootAsync(...);
```

README повинен окремо показувати:

1. інтеграцію через starter `AppConfigService`;
2. інтеграцію через стандартний Nest `ConfigService`;
3. інтеграцію через plain options object;
4. override concrete adapter.

---

## 13. Уточнити документацію щодо framework independence

**Критичність:** Medium  
**Класифікація:** Documentation mismatch  
**Пріоритет:** P2

### Документація заявляє

Бізнес-логіка незалежна від framework.

### Фактична реалізація

Application use cases використовують `@Injectable()` та `@Inject()` із `@nestjs/common`.

### Що потрібно змінити

Обрати один варіант:

#### Варіант A — виправити код

Прибрати NestJS із Application layer і залишити framework registration у composition root.

#### Варіант B — виправити документацію

Заявляти незалежність Domain і Contracts, але явно фіксувати NestJS DI coupling Application layer.

Не можна одночасно залишати decorators і заявляти повну framework independence всіх внутрішніх шарів.

---

# Обов’язкова runtime-перевірка після виправлень

Наведені нижче пункти не були підтверджені як дефекти, але мають бути обов’язково перевірені перед фінальною оцінкою starter kit.

## 14. Виконати чисте встановлення залежностей

```bash
npm ci
```

### Критерії приймання

- команда завершується успішно;
- lock-файл не змінюється;
- немає dependency resolution errors;
- package manager відповідає lock-файлу та документації.

---

## 15. Виконати build і typecheck

```bash
npm run build
```

За наявності окремої команди:

```bash
npm run typecheck
```

### Критерії приймання

- усі apps і libraries компілюються;
- path aliases працюють у build output;
- немає TypeScript errors;
- build не залежить від локально встановленого global Nest CLI.

---

## 16. Виконати lint без врахування суто форматувальних проблем

```bash
npm run lint
```

### Критерії приймання

Не повинно бути lint errors, які вказують на:

- unsafe types;
- floating promises;
- неправильний async flow;
- невикористані dependencies, що приховують composition problem;
- циклічні imports;
- порушення layer boundaries.

Prettier і formatting не впливають на архітектурну оцінку.

---

## 17. Перевірити bootstrap кожного entrypoint

Перевірити окремо:

- API;
- Worker;
- Cron;
- migrations entrypoint.

### Для кожного entrypoint перевірити

- DI container створюється;
- підключається лише потрібна infrastructure;
- Worker/Cron не запускають HTTP server;
- shutdown hooks працюють;
- process завершується після SIGTERM;
- connections закриваються;
- startup dependency failures не ігноруються;
- відсутні непотрібні env/secrets requirements.

---

## 18. Перевірити Docker startup flow

Перевірити:

- `Dockerfile`;
- `docker-compose.yml`;
- `docker-compose.prod.yml`;
- build context;
- production command;
- migrations ordering;
- healthchecks;
- restart policies;
- graceful shutdown.

### Критерії приймання

- image збирається з чистого checkout;
- API, Worker і Cron можна deploy-ити окремо;
- migrations не запускаються конкурентно кожною replica;
- application не приймає traffic до завершення required migrations;
- healthcheck перевіряє реальну готовність entrypoint.

---

## 19. Перевірити migration concurrency

### Ризик, який потрібно виключити

Кілька production instances або migration containers не повинні одночасно виконувати один migration set без coordination.

### Що перевірити

- чи Drizzle migration table достатньо захищає concurrent startup;
- чи використовується advisory lock або окремий one-shot migration job;
- чи API replicas не запускають migrations автоматично одночасно;
- чи failed migration блокує application startup.

### Рекомендований flow

```text
one-shot migration job
  -> successful completion
    -> API/Worker/Cron deployment
```

---

## 20. Перевірити graceful shutdown активних BullMQ jobs

### Що перевірити

- worker припиняє брати нові jobs після SIGTERM;
- активним jobs надається час завершитися;
- BullMQ worker/queue/events connections закриваються;
- незавершена job повертається в retry/stalled flow коректно;
- email side effect не дублюється після restart;
- Outbox ownership/lease звільняється або стає stale передбачувано.

---

# Порядок реалізації

Рекомендована послідовність:

1. Атомарний `IJobExecutionStore` та `EmailProcessor`.
2. Outbox lease renewal і ownership checks.
3. Typed options для Outbox processor.
4. `forRoot` / `forRootAsync` для Redis, Drizzle, BullMQ, Mail, Storage, Auth, RateLimiter і Locks.
5. Entry-point-specific env validation.
6. Явна BullMQ queue registration.
7. Strategy-specific Auth providers.
8. Прибрати або мінімізувати `@Global()`.
9. Визначити остаточну політику щодо NestJS у Application layer.
10. Оновити README, examples і non-technical overview.
11. Виконати чистий build/typecheck/lint.
12. Перевірити API, Worker, Cron, migrations і Docker runtime.

---

# Definition of Done для starter kit

Starter Kit можна вважати готовим до повторного production-використання, коли виконані всі умови:

- email та інші зовнішні side effects мають конкурентно безпечну idempotency;
- Outbox lease не завершується під час активної обробки;
- business write та Outbox write залишаються в одній DB transaction;
- reusable modules мають typed `forRoot` / `forRootAsync` API;
- жоден reusable module не вимагає `AppConfigService` як обов’язкову dependency;
- API, Worker, Cron і migrations мають мінімальні окремі composition roots;
- кожен entrypoint валідує лише власну конфігурацію;
- Auth створює лише вибрану strategy;
- BullMQ реєструє лише потрібні queues;
- global modules не приховують dependency chains;
- документація точно відповідає реалізації;
- `npm ci`, build, typecheck і meaningful lint завершуються успішно;
- усі entrypoints проходять bootstrap і graceful shutdown;
- Docker image та Compose startup перевірені;
- migration flow безпечний для multi-instance deployment.
