# NestJS Backend Foundation Starter

Starter-kit для NestJS-проєктів, побудований у стилі **Onion Architecture** та **Multi-entrypoint Architecture**.

Цей проєкт не є простим boilerplate. Його ціль — бути переносимою backend foundation-платформою, яку можна копіювати в новий проєкт і одразу починати писати бізнес-логіку, не витрачаючи час на повторне налаштування базових інфраструктурних модулів.

Starter включає:

- NestJS;
- Onion Architecture;
- multi-entrypoint apps: `api`, `worker`, `cron`;
- PostgreSQL + Drizzle ORM;
- Redis;
- BullMQ;
- typed config;
- structured logger;
- cache layer;
- health checks;
- global exception handling;
- mail module (React Email templates);
- storage module;
- transaction manager;
- event bus;
- outbox pattern;
- audit logs;
- rate limiter;
- distributed locks;
- idempotency;
- приклад feature-модуля `users`;
- Docker Compose;
- ESLint + Prettier;
- базову структуру для тестів.

---

# 1. Загальна ідея

Проєкт побудований так, щоб бізнес-логіка була незалежною від фреймворків, бази даних, Redis, HTTP, BullMQ та будь-якої конкретної інфраструктури.

Основний принцип:

```txt
domain -> application -> contracts <- infrastructure
                         ^
                         |
                       apps
```

Тобто:

- `domain` не знає нічого про Drizzle, Redis, HTTP, env, logger;
- `application` працює тільки через контракти;
- `contracts` описують інтерфейси;
- `infrastructure` реалізує ці інтерфейси;
- `apps/*` збирають потрібні модулі під конкретний entrypoint.

Domain і contracts є framework-independent. Application use cases використовують NestJS DI decorators для зручної композиції, але не залежать від infrastructure implementations.

---

# 2. Архітектура проєкту

## 2.1. Структура

```txt
apps/
  api/
    src/
      main.ts
      api.module.ts
      controllers/
      dto/
      presenters/
      filters/
      guards/
      interceptors/

  worker/
    src/
      main.ts
      worker.module.ts
      processors/

  cron/
    src/
      main.ts
      cron.module.ts
      schedules/

libs/
  domain/
    src/
      entities/
      value-objects/
      events/
      errors/

  application/
    src/
      use-cases/
      services/
      dto/
      ports/
      events/

  contracts/
    src/
      repositories/
      gateways/
      queues/
      cache/
      storage/
      mail/
      events/
      locks/
      transactions/
      tokens.ts

  infrastructure/
    src/
      config/
      logger/
      database/
      redis/
      bullmq/
      cache/
      storage/
      mail/
      health/
      exceptions/
      transactions/
      events/
      outbox/
      audit/
      rate-limiter/
      locks/
      idempotency/
      repositories/
      mappers/
      infrastructure.module.ts

  shared/
    src/
      dto/
      utils/
      types/
      constants/
      pagination/
      result/
```

---

# 3. Entry points

Проєкт має три окремі entrypoint-и.

## 3.1. API

Шлях:

```txt
apps/api
```

Призначення:

- HTTP API;
- controllers;
- DTO validation;
- guards;
- interceptors;
- exception filters;
- presenters;
- health endpoints.

Запуск:

```bash
npm run start:api
```

Dev-запуск:

```bash
npm run start:dev:api
```

API не повинен запускати worker processors або cron jobs.

---

## 3.2. Worker

Шлях:

```txt
apps/worker
```

Призначення:

- BullMQ processors;
- обробка email jobs;
- обробка outbox jobs;
- обробка background tasks.

Запуск:

```bash
npm run start:worker
```

Dev-запуск:

```bash
npm run start:dev:worker
```

Worker не повинен піднімати HTTP API або cron schedules.

---

## 3.3. Cron

Шлях:

```txt
apps/cron
```

Призначення:

- запуск scheduled jobs;
- постановка технічних job у BullMQ;
- координація періодичних задач через distributed lock.

Запуск:

```bash
npm run start:cron
```

Dev-запуск:

```bash
npm run start:dev:cron
```

Cron не повинен піднімати HTTP API або BullMQ processors, якщо вони не потрібні конкретному schedule.

---

# 4. Основні архітектурні правила

## 4.1. Domain

`domain` — це чистий TypeScript.

Тут можуть бути:

- entities;
- value objects;
- domain events;
- domain errors;
- domain services, якщо вони не залежать від інфраструктури.

Тут не повинно бути:

- NestJS decorators;
- Drizzle schema;
- Redis;
- BullMQ;
- HTTP;
- ConfigService;
- logger;
- process.env.

Приклад:

```txt
libs/domain/src/entities/user.entity.ts
libs/domain/src/value-objects/email.vo.ts
libs/domain/src/events/user-created.event.ts
```

---

## 4.2. Application

`application` містить use-cases і application services.

Тут описується сценарій виконання бізнес-операції.

Application може залежати від:

- `domain`;
- `contracts`;
- `shared`.

Application не має залежати від:

- `infrastructure`;
- Drizzle;
- Redis;
- BullMQ;
- HTTP controllers;
- concrete repositories.

Приклад:

```txt
libs/application/src/use-cases/users/create-user.usecase.ts
```

Use-case не знає, де саме зберігається користувач — у PostgreSQL, MongoDB, API чи mock repository. Він знає тільки контракт:

```ts
IUserRepository;
```

---

## 4.3. Contracts

`contracts` — це шар інтерфейсів.

Тут описуються абстракції, через які application працює із зовнішнім світом.

Приклади:

```txt
libs/contracts/src/repositories/user.repository.ts
libs/contracts/src/cache/cache-gateway.contract.ts
libs/contracts/src/mail/email-gateway.contract.ts
libs/contracts/src/storage/storage-gateway.contract.ts
libs/contracts/src/transactions/transaction-manager.contract.ts
libs/contracts/src/events/event-bus.contract.ts
```

Також тут знаходяться DI tokens:

```txt
libs/contracts/src/tokens.ts
```

Приклад:

```ts
export const TOKENS = {
  UserRepository: Symbol('IUserRepository'),
  QueueGateway: Symbol('IQueueGateway'),
  CacheGateway: Symbol('ICacheGateway'),
  TransactionManager: Symbol('ITransactionManager'),
} as const;
```

---

## 4.4. Infrastructure

`infrastructure` реалізує контракти.

Тут знаходяться:

- Drizzle repositories;
- Redis adapters;
- BullMQ gateway;
- cache implementation;
- SMTP adapter;
- S3/local storage adapter;
- transaction manager;
- outbox;
- audit logger;
- rate limiter;
- distributed lock;
- idempotency service.

Application не імпортує infrastructure напряму.

---

## 4.5. Apps

`apps/*` — це композиційний шар.

Тут ми збираємо потрібні модулі для конкретного entrypoint.

Наприклад:

- `apps/api` імпортує API controllers, application use-cases та infrastructure providers;
- `apps/worker` імпортує processors, application use-cases та потрібну infrastructure;
- `apps/cron` імпортує schedules, application use-cases та потрібну infrastructure.

---

# 5. Модулі

## 5.1. Config Module

Шлях:

```txt
libs/infrastructure/src/config
```

Призначення:

- централізоване читання env;
- typed config;
- env validation;
- заборона прямого використання `process.env` у бізнес-коді.

Config має секції:

```txt
app
database
redis
bullmq
mail
storage
jwt
rateLimit
logger
```

Приклад використання:

```ts
const databaseUrl = configService.get('database.url');
const redisHost = configService.get('redis.host');
const attempts = configService.get('bullmq.defaultAttempts');
```

У бізнес-коді не потрібно використовувати:

```ts
process.env.DATABASE_URL;
```

Правильно:

```ts
configService.get('database.url');
```

Але навіть `configService` має використовуватись переважно в infrastructure-шарі, а не в domain/application.

---

## 5.2. Logger Module

Шлях:

```txt
libs/infrastructure/src/logger
```

Призначення:

- structured logs;
- JSON logs у production;
- pretty logs у development;
- requestId;
- correlationId;
- traceId;
- log levels.

Базові методи:

```ts
debug(message: string, context?: object): void
info(message: string, context?: object): void
warn(message: string, context?: object): void
error(message: string, error?: unknown, context?: object): void
```

Приклад:

```ts
this.logger.info('User created', {
  userId: user.id,
});
```

Для API використовується `RequestContextMiddleware`.

Middleware:

- читає `x-request-id`, якщо його передав клієнт або proxy;
- створює UUID, якщо header відсутній або невалідний;
- читає або створює `x-correlation-id`;
- додає обидва header-и у HTTP response;
- створює AsyncLocalStorage context для всього запиту.

Реєстрація виконується у:

```txt
apps/api/src/api.module.ts

consumer
  .apply(RequestContextMiddleware)
  .forRoutes({
    path: '*',
    method: RequestMethod.ALL,
  });
```

AppLogger автоматично додає до structured logs:
requestId
correlationId
userId
traceId

---

## 5.3. PostgreSQL + Drizzle Module

Шлях:

```txt
libs/infrastructure/src/database/drizzle
```

Призначення:

- створення PostgreSQL connection pool;
- створення Drizzle client;
- експорт `DRIZZLE_DB`;
- schema definitions;
- migrations;
- health check;
- graceful shutdown pool.

Структура:

```txt
database/
  drizzle/
    drizzle.module.ts
    drizzle.service.ts
    drizzle.tokens.ts
    schema/
      users.schema.ts
      audit-logs.schema.ts
      outbox-events.schema.ts
    migrations/
```

Use-cases не працюють з Drizzle напряму.

Неправильно:

```ts
class CreateUserUseCase {
  constructor(private readonly db: DrizzleDb) {}
}
```

Правильно:

```ts
class CreateUserUseCase {
  constructor(private readonly userRepository: IUserRepository) {}
}
```

Drizzle використовується тільки в repository implementation:

```txt
libs/infrastructure/src/repositories/user-drizzle.repository.ts
```

---

## 5.4. Redis Module

Шлях:

```txt
libs/infrastructure/src/redis
```

Призначення:

- створення Redis client через `ioredis`;
- централізована робота з Redis;
- graceful shutdown;
- логування connection errors;
- окремі clients для cache/queue, якщо потрібно.

RedisService має методи:

```ts
get(key: string): Promise<string | null>
set(key: string, value: string, ttlSeconds?: number): Promise<void>
del(key: string): Promise<void>
exists(key: string): Promise<boolean>
ttl(key: string): Promise<number>
incr(key: string): Promise<number>
expire(key: string, seconds: number): Promise<void>
```

Приклад:

```ts
await redisService.set('users:1', JSON.stringify(user), 60);
const value = await redisService.get('users:1');
```

Application не повинна використовувати Redis напряму. Для application є cache contract.

---

## 5.5. BullMQ Module

Шлях:

```txt
libs/infrastructure/src/bullmq
```

Призначення:

- робота з чергами;
- додавання jobs;
- retry/backoff;
- delayed jobs;
- job logging;
- graceful shutdown.

Базові queue names:

```ts
export const QUEUES = {
  DEFAULT: 'default',
  EMAIL: 'email',
  EVENTS: 'events',
  OUTBOX: 'outbox',
} as const;
```

Основний контракт:

```ts
add<T>(
  queueName: string,
  jobName: string,
  payload: T,
  options?: QueueJobOptions,
): Promise<string>

addBulk<T>(
  queueName: string,
  jobs: Array<{
    name: string;
    payload: T;
    options?: QueueJobOptions;
  }>,
): Promise<string[]>
```

Приклад:

```ts
await queueGateway.add(QUEUES.EMAIL, 'send-welcome-email', {
  userId: user.id,
  email: user.email,
});
```

Worker processors не повинні містити бізнес-логіку. Вони мають викликати application use-cases або application services.

Неправильно:

```ts
@Processor('email')
export class EmailProcessor {
  async process(job: Job) {
    // багато бізнес-логіки тут
  }
}
```

Правильно:

```ts
@Processor('email')
export class EmailProcessor {
  constructor(private readonly sendWelcomeEmailUseCase: SendWelcomeEmailUseCase) {}

  async process(job: Job) {
    await this.sendWelcomeEmailUseCase.execute(job.data);
  }
}
```

---

## 5.6. Cache Module

Шлях:

```txt
libs/infrastructure/src/cache
```

Призначення:

- application-level cache;
- JSON serialization/deserialization;
- TTL;
- key prefix;
- graceful handling, якщо Redis тимчасово недоступний.

Application бачить тільки контракт:

```ts
ICacheGateway;
```

Методи:

```ts
get<T>(key: string): Promise<T | null>
set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
del(key: string): Promise<void>
remember<T>(key: string, ttlSeconds: number, resolver: () => Promise<T>): Promise<T>
forgetByPattern(pattern: string): Promise<void>
```

Приклад:

```ts
const user = await cache.remember(`users:${id}`, 60, async () => {
  return this.userRepository.findById(id);
});
```

Для чого потрібен cache module:

- кешування частих запитів;
- зменшення навантаження на базу;
- кешування конфігурацій;
- кешування результатів дорогих обчислень.

---

## 5.7. Health Module

Шлях:

```txt
libs/infrastructure/src/health
```

Призначення:

- перевірка, чи додаток живий;
- перевірка готовності сервісу приймати трафік;
- перевірка залежностей: PostgreSQL, Redis, BullMQ.

Endpoints:

```txt
GET /health
GET /health/live
GET /health/ready
```

Приклад відповіді:

```json
{
  "status": "ok",
  "services": {
    "postgres": "ok",
    "redis": "ok",
    "bullmq": "ok"
  }
}
```

Використовується для:

- Docker healthcheck;
- Kubernetes readiness/liveness probes;
- моніторингу;
- CI/CD перевірок після deploy.

---

## 5.8. Exception Module

Шлях:

```txt
libs/infrastructure/src/exceptions
```

Призначення:

- єдиний формат помилок;
- mapping domain/application errors у HTTP response;
- safe production errors;
- logging unexpected errors.

Domain/application можуть кидати:

```ts
BusinessError;
ValidationError;
NotFoundError;
ConflictError;
```

HTTP response має виглядати так:

```json
{
  "success": false,
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User not found",
    "details": {}
  }
}
```

Для чого це потрібно:

- однаковий формат помилок по всьому API;
- простіша обробка помилок на frontend;
- безпечні production responses;
- централізоване логування unexpected errors.

---

## 5.9. Mail Module

Шлях:

```txt
libs/infrastructure/src/mail
  components/          # React Email UI primitives (Layout, Block, Title, …)
  config/              # TailwindConfig для @react-email/components
  templates/           # листи як React-компоненти (*.email.tsx)
  mail-template.service.ts
  mail-template.registry.tsx
  smtp-mail.adapter.ts
  null-mail.adapter.ts
```

Призначення:

- відправка email через `IEmailGateway` (SMTP / null adapter);
- **React Email** — верстка листів компонентами (`@react-email/components`, `@react-email/render`);
- рендер `html` + `text` у worker, не в use case;
- типізовані шаблони в contracts (`EMAIL_TEMPLATE`, `EmailTemplateDataMap`).

### Контракти

```txt
libs/contracts/src/mail/
  email-gateway.ts       # IEmailGateway.send({ to, subject, html, text })
  email-template-id.ts   # EMAIL_TEMPLATE.WELCOME, …
  email-template-data.ts # дані для кожного шаблону
  email-job.ts           # payload для черги EMAIL (template + data | raw html)
```

### Потік відправки (рекомендовано)

```txt
HTTP -> use-case -> queue EMAIL (template + data)
  -> EmailProcessor -> MailTemplateService.render()
  -> IEmailGateway.send({ html, text })
```

Use case **не** містить HTML — лише `template` і `data`:

```ts
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';

await queueGateway.add(QUEUES.EMAIL, 'send-welcome', {
  to: user.email,
  subject: 'Welcome',
  template: EMAIL_TEMPLATE.WELCOME,
  data: { email: user.email },
});
```

### Новий лист (React Email)

1. Додати id у `email-template-id.ts` і тип даних у `email-template-data.ts`.
2. Створити `libs/infrastructure/src/mail/templates/my-feature.email.tsx` з компонентами з `../components`.
3. Зареєструвати в `mail-template.registry.tsx`.
4. Поставити job у use case з `template` + `data`.

Приклад шаблону:

```tsx
import { Block, Layout, Paragraph, Signoff, Title } from '../components';

export const WelcomeEmail = ({ email }: { email: string }) => (
  <Layout>
    <Block>
      <Title>Welcome!</Title>
    </Block>
    <Block>
      <Paragraph>Account {email} is ready.</Paragraph>
    </Block>
    <Block disableMargin>
      <Signoff from="Support Team" />
    </Block>
  </Layout>
);
```

### Env

```env
MAIL_DRIVER=null   # dev: листи не відправляються (NullMailAdapter)
MAIL_DRIVER=smtp   # prod: SMTP_*
```

Worker має бути запущений: `npm run start:dev:worker`.

Детальніше: [EXAMPLES.md](./EXAMPLES.md) (розділ про email).

---

## 5.10. Storage Module

Шлях:

```txt
libs/infrastructure/src/storage
```

Призначення:

- робота з файлами;
- local storage;
- S3 storage;
- Minio-compatible storage;
- signed URLs.

Контракт:

```ts
IStorageGateway;
```

Методи:

```ts
putObject(input: {
  key: string;
  body: Buffer | NodeJS.ReadableStream;
  contentType?: string;
}): Promise<{ key: string; url?: string }>;

getObject(key: string): Promise<Buffer>;

deleteObject(key: string): Promise<void>;

getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
```

Приклад:

```ts
await storage.putObject({
  key: `avatars/${userId}.png`,
  body: file.buffer,
  contentType: file.mimetype,
});
```

Application не має знати, де фізично лежить файл — локально, в S3 чи Minio.

---

## 5.11. Transaction Module

Шлях:

```txt
libs/infrastructure/src/transactions
```

Призначення:

- запуск кількох repository operations в одній транзакції;
- передача transaction context у repositories;
- підтримка роботи repository як з transaction, так і без неї.

Контракт:

```ts
ITransactionManager;
```

Метод:

```ts
run<T>(handler: (trx: TransactionContext) => Promise<T>): Promise<T>
```

Приклад:

```ts
await transactionManager.run(async (trx) => {
  await userRepository.insert(user, trx);
  await auditRepository.create(log, trx);
});
```

Для чого це потрібно:

- атомарність операцій;
- rollback при помилці;
- консистентність даних;
- безпечні фінансові або критичні операції.

---

## 5.12. Domain Events

Окремий `EventBusModule` у поточній реалізації відсутній.

---

## 5.13. Outbox Module

Шлях:

```txt
libs/infrastructure/src/outbox
```

Призначення:

- надійна доставка domain events;
- збереження events у PostgreSQL;
- подальша доставка через worker/cron;
- захист від втрати events, якщо queue або зовнішній сервіс тимчасово недоступні.

Таблиця:

```txt
outbox_events
```

Поля:

```txt
id
event_name
payload
occurred_at
status
attempts
available_at
locked_at
locked_by
processed_at
error
created_at
updated_at
```

Статуси:

```txt
pending
processing
processed
failed
```

Типовий flow:

```txt
1. Use-case виконує бізнес-операцію
2. У тій самій PostgreSQL-транзакції domain event записується в outbox_events
3. Worker знаходить pending або прострочені processing events
4. Worker атомарно захоплює записи через SELECT FOR UPDATE SKIP LOCKED
5. Подія переводиться у status=processing
6. Подія публікується в BullMQ queue
7. Після успішної публікації outbox event позначається як processed
8. Якщо була помилка — attempts збільшується, error зберігається
9. До наступної спроби встановлюється available_at
10. Після досягнення максимального attempts подія переходить у failed
```

Для чого потрібен outbox:

- не втрачати важливі events;
- безпечно інтегрувати DB transaction і async processing;
- мати retries;
- бачити історію подій;
- підтримувати eventual consistency.

---

## 5.14. Audit Module

Шлях:

```txt
libs/infrastructure/src/audit
```

Призначення:

- запис важливих дій користувачів;
- запис системних дій;
- історія змін;
- security/audit trail.

Таблиця:

```txt
audit_logs
```

Поля:

```txt
id
actor_id
actor_type
action
entity_type
entity_id
metadata
ip
user_agent
created_at
```

Контракт:

```ts
IAuditLogger;
```

Метод:

```ts
log(input: AuditLogInput): Promise<void>
```

Приклад:

```ts
await auditLogger.log({
  actorId: user.id,
  actorType: 'user',
  action: 'user.created',
  entityType: 'user',
  entityId: user.id,
  metadata: {
    email: user.email.value,
  },
});
```

Audit не має ламати основний flow. Якщо audit logging впав, зазвичай це треба залогувати, але не валити use-case, окрім критичних сценаріїв.

---

## 5.15. Rate Limiter Module

Шлях:

```txt
libs/infrastructure/src/rate-limiter
```

Призначення:

- захист API від надмірної кількості запитів;
- захист login/register endpoints;
- захист OTP;
- захист webhook endpoints;
- базовий anti-abuse layer.

Контракт:

```ts
IRateLimiter;
```

Метод:

```ts
check(input: {
  key: string;
  limit: number;
  ttlSeconds: number;
}): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}>
```

Приклад:

```ts
const result = await rateLimiter.check({
  key: `login:${ip}`,
  limit: 5,
  ttlSeconds: 60,
});

if (!result.allowed) {
  throw new TooManyRequestsException();
}
```

Для API можна зробити guard/interceptor, який автоматично перевіряє rate limit.

---

## 5.16. Distributed Lock Module

Шлях:

```txt
libs/infrastructure/src/locks
```

Призначення:

- захист від одночасного виконання однієї задачі в кількох процесах;
- worker jobs;
- cron jobs;
- distributed deployments;
- уникнення подвійної обробки.

Контракт:

```ts
IDistributedLock;
```

Методи:

```ts
acquire(key: string, ttlMs: number): Promise<LockHandle | null>
release(handle: LockHandle): Promise<void>
runWithLock<T>(
  key: string,
  ttlMs: number,
  handler: () => Promise<T>,
): Promise<T>
```

Приклад:

```ts
await distributedLock.runWithLock('outbox:process', 30_000, async () => {
  await outboxProcessor.processPendingEvents();
});
```

Для чого це потрібно:

- якщо cron запущений у кількох replicas;
- якщо worker може отримати дубльований job;
- якщо треба гарантувати, що певна операція виконується тільки одним процесом.

---

## 5.17. Idempotency Module

Шлях:

```txt
libs/infrastructure/src/idempotency
```

Призначення:

- захист від повторних HTTP-запитів;
- захист від повторних webhook events;
- захист від повторного виконання critical jobs;
- повернення збереженої відповіді для однакового request.

Поточна idempotency-реалізація використовує Redis. Вона добре підходить для звичайних API-операцій. Для фінансово критичних операцій рекомендується durable PostgreSQL implementation.

Redis-реалізація використовує два типи ключів:

```txt
idem:<scope>:<idempotency-key>:lock
idem:<scope>:<idempotency-key>:result
```

lock не дозволяє двом однаковим запитам одночасно виконати handler.

Контракт:

```ts
IIdempotencyService;
```

Метод:

```ts
execute<T>(input: {
  key: string;
  scope: string;
  requestHash: string;
  ttlSeconds: number;
  lockTtlSeconds?: number;
  handler: () => Promise<T>;
}): Promise<T>
```

`ttlSeconds` визначає час зберігання готового результату.

`lockTtlSeconds` визначає максимальний час життя processing lock.

Приклад:

```ts
await idempotencyService.execute({
  key: idempotencyKey,
  scope: 'orders:create',
  requestHash,
  ttlSeconds: 3600,
  handler: async () => {
    return this.createOrderUseCase.execute(input);
  },
});
```

Для API interceptor може читати header:

```txt
Idempotency-Key
```

Для чого це потрібно:

- користувач натиснув кнопку двічі;
- frontend повторив запит;
- webhook provider прислав один event кілька разів;
- job був повторно поставлений у queue.

---

# 6. Users feature example

Starter містить приклад feature `users`.

## 6.1. Domain

```txt
libs/domain/src/entities/user.entity.ts
libs/domain/src/value-objects/email.vo.ts
libs/domain/src/events/user-created.event.ts
```

Тут знаходиться бізнес-модель користувача.

Приклад відповідальності domain entity:

- створення користувача;
- зміна балансу;
- domain validation;
- створення domain events.

---

## 6.2. Contracts

```txt
libs/contracts/src/repositories/user.repository.ts
```

Тут описаний інтерфейс repository:

```ts
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}
```

Application працює з цим інтерфейсом, а не з Drizzle напряму.

---

## 6.3. Application

```txt
libs/application/src/use-cases/users/create-user.usecase.ts
libs/application/src/use-cases/users/get-user-by-id.usecase.ts
libs/application/src/use-cases/users/deposit-user-balance.usecase.ts
```

Приклад flow для `CreateUserUseCase`:

```txt
1. Прийняти input DTO
2. Перевірити, чи email вже існує
3. Створити domain entity User
4. Зберегти User через IUserRepository
5. Опублікувати UserCreatedEvent
6. Повернути результат
```

---

## 6.4. Infrastructure

```txt
libs/infrastructure/src/repositories/user-drizzle.repository.ts
libs/infrastructure/src/mappers/user.mapper.ts
```

Тут знаходиться конкретна реалізація repository через Drizzle.

Mapper відповідає за конвертацію:

```txt
DB row -> Domain entity
Domain entity -> DB insert/update
Domain entity -> Response DTO
```

Domain entity не має бути Drizzle schema.

---

## 6.5. API

```txt
apps/api/src/controllers/users.controller.ts
```

Controller:

- приймає HTTP request;
- валідовує DTO;
- викликає use-case;
- повертає response.

Controller не містить бізнес-логіки.

Неправильно:

```ts
@Post()
async create(@Body() dto: CreateUserDto) {
  // створення user, перевірки, бізнес-логіка прямо тут
}
```

Правильно:

```ts
@Post()
async create(@Body() dto: CreateUserDto) {
  return this.createUserUseCase.execute(dto);
}
```

---

# 7. Users flow

`POST /users`

Повний flow:

```txt
1. Controller приймає DTO
2. Controller викликає CreateUserUseCase
3. Use-case перевіряє бізнес-правила
4. Use-case створює User entity
5. Use-case зберігає User через IUserRepository
6. Repository мапить domain entity у DB row
7. Drizzle записує user у PostgreSQL
8. Use-case публікує UserCreatedEvent
9. EventBus записує event в Outbox або обробляє in-memory
10. Worker/Cron доставляє event у BullMQ
11. Email processor відправляє welcome email
```

---

# 8. Docker

## 8.1. Запуск через Docker Compose

Створити `.env`:

```bash
cp .env.example .env
```

Запустити:

```bash
docker compose up --build
```

Або у фоні:

```bash
docker compose up -d --build
```

---

## 8.2. Сервіси

Docker Compose піднімає:

```txt
postgres
redis
api
worker
cron
```

Кожен entrypoint запускається окремо:

```txt
api    -> npm run start:api
worker -> npm run start:worker
cron   -> npm run start:cron
```

---

## 8.3. Важливі env для Docker

У Docker потрібно використовувати service names:

```env
DATABASE_URL=postgresql://app:app@postgres:5432/app
REDIS_HOST=redis
REDIS_PORT=6379
```

Не потрібно використовувати:

```env
DATABASE_URL=postgresql://app:app@localhost:5432/app
REDIS_HOST=localhost
```

Тому що `localhost` всередині контейнера — це сам контейнер.

---

## 8.4. Міграції

Підняти PostgreSQL і Redis:

```bash
docker compose up -d postgres redis
```

Запустити міграції:

```bash
docker compose run --rm api npm run db:migrate
```

Після цього підняти всі сервіси:

```bash
docker compose up -d --build
```

---

## 8.5. Логи

API:

```bash
docker compose logs -f api
```

Worker:

```bash
docker compose logs -f worker
```

Cron:

```bash
docker compose logs -f cron
```

---

# 9. Local development

## 9.1. Встановити залежності

```bash
npm install
```

## 9.2. Створити `.env`

```bash
cp .env.example .env
```

## 9.3. Запустити PostgreSQL і Redis

Можна через Docker:

```bash
docker compose up -d postgres redis
```

## 9.4. Запустити API

```bash
npm run start:dev:api
```

## 9.5. Запустити Worker

```bash
npm run start:dev:worker
```

## 9.6. Запустити Cron

```bash
npm run start:dev:cron
```

---

# 10. Package scripts

```json
{
  "start:api": "nest start api",
  "start:worker": "nest start worker",
  "start:cron": "nest start cron",

  "start:dev:api": "nest start api --watch",
  "start:dev:worker": "nest start worker --watch",
  "start:dev:cron": "nest start cron --watch",

  "build:api": "nest build api",
  "build:worker": "nest build worker",
  "build:cron": "nest build cron",

  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",

  "lint": "eslint .",
  "format": "prettier --write .",
  "test": "jest",
  "test:unit": "jest --config jest.unit.config.ts",
  "test:int": "jest --config jest.integration.config.ts"
}
```

---

# 11. ESLint and Prettier

Проєкт має бути налаштований так, щоб підтримувати однаковий стиль коду.

Запустити lint:

```bash
npm run lint
```

Автоформатування:

```bash
npm run format
```

Рекомендовано перевіряти перед commit:

```bash
npm run lint
npm run test
npm run build:api
npm run build:worker
npm run build:cron
```

---

# 12. Як додати нову feature

Приклад: потрібно додати feature `orders`.

## 12.1. Domain

Створити:

```txt
libs/domain/src/entities/order.entity.ts
libs/domain/src/value-objects/order-status.vo.ts
libs/domain/src/events/order-created.event.ts
```

Тут описати бізнес-модель.

---

## 12.2. Contracts

Створити repository contract:

```txt
libs/contracts/src/repositories/order.repository.ts
```

Приклад:

```ts
export interface IOrderRepository {
  findById(id: string): Promise<Order | null>;
}
```

Додати token:

```ts
export const TOKENS = {
  OrderRepository: Symbol('IOrderRepository'),
};
```

---

## 12.3. Application

Створити use-cases:

```txt
libs/application/src/use-cases/orders/create-order.usecase.ts
libs/application/src/use-cases/orders/get-order-by-id.usecase.ts
```

Use-case має працювати тільки через contracts.

---

## 12.4. Infrastructure

Створити Drizzle schema:

```txt
libs/infrastructure/src/database/drizzle/schema/orders.schema.ts
```

Створити repository implementation:

```txt
libs/infrastructure/src/repositories/order-drizzle.repository.ts
```

Створити mapper:

```txt
libs/infrastructure/src/mappers/order.mapper.ts
```

Зареєструвати provider у відповідному infrastructure module.

---

## 12.5. API

Створити controller:

```txt
apps/api/src/controllers/orders.controller.ts
```

Controller має викликати use-case.

---

# 13. Як додати новий repository

1. Описати contract у `libs/contracts`.
2. Додати DI token у `tokens.ts`.
3. Додати Drizzle schema, якщо потрібна таблиця.
4. Реалізувати repository в `libs/infrastructure/src/repositories`.
5. Додати mapper.
6. Зареєструвати provider в infrastructure module.
7. Використовувати contract у use-case.

Приклад provider:

```ts
{
  provide: TOKENS.UserRepository,
  useClass: UserDrizzleRepository,
}
```

---

# 14. Як додати новий queue processor

1. Додати queue name в `QUEUES`, якщо потрібно.
2. Створити processor у `apps/worker/src/processors`.
3. Processor має приймати job і викликати use-case.
4. Зареєструвати processor у `WorkerModule`.

Приклад:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { QUEUES } from '@contracts/queues/queue-names';

@Processor(QUEUES.MY_JOB)
export class MyJobProcessor extends WorkerHost {
  constructor(private readonly useCase: MyJobUseCase) {
    super();
  }

  async process(job: Job<MyJobPayload>): Promise<void> {
    await this.useCase.execute(job.data);
  }
}
```

Processor повинен залишатися transport adapter-ом.

Бізнес-логіку не слід розміщувати безпосередньо у `process()`. Processor має викликати application use case або event handler.

---

# 15. Як додати новий scheduled job

1. Створити schedule у:

```txt
apps/cron/src/schedules
```

2. Inject потрібний use-case або service.
3. Якщо cron може бути запущений у кількох replicas, використати distributed lock.
4. Зареєструвати schedule у `CronModule`.

Приклад:

```ts
@Injectable()
export class OutboxSchedule {
  constructor(
    private readonly processOutboxUseCase: ProcessOutboxUseCase,
    @Inject(TOKENS.DistributedLock)
    private readonly lock: IDistributedLock,
  ) {}

  @Cron('*/30 * * * * *')
  async handle() {
    await this.lock.runWithLock('cron:outbox', 30_000, async () => {
      await this.processOutboxUseCase.execute();
    });
  }
}
```

---

# 16. Transactions

Transactions використовуються тоді, коли кілька операцій мають бути виконані атомарно.

Приклад:

```ts
await transactionManager.run(async (trx) => {
  await userRepository.insert(user, trx);
  await auditRepository.create(log, trx);
});
```

Repository має вміти працювати:

- без transaction;
- з transaction context.

Use-case не має знати деталей Drizzle transaction. Він передає абстрактний `TransactionContext`.

---

# 16.1. Авторизація: JWT і Session

Режим авторизації задається через:

```env
AUTH_DRIVER=jwt
```

або:

```env
AUTH_DRIVER=session
```

## JWT mode

У JWT-режимі сервер повертає два токени:

- `accessToken` — короткоживучий токен доступу;
- `refreshToken` — довгоживучий токен для оновлення авторизації.

Приклад:

```json
{
  "accessToken": "<access-token>",
  "refreshToken": "<refresh-token>"
}
```

Access token передається через:

```http
Authorization: Bearer <access-token>
```

## Refresh-token rotation

Refresh token є одноразовим.

Після кожного успішного:

```http
POST /auth/refresh
```

сервер:

1. перевіряє підпис refresh token;
2. перевіряє його стан у Redis;
3. видаляє старий refresh token;
4. створює новий access token;
5. створює новий refresh token;
6. атомарно записує новий refresh token у Redis;
7. повертає клієнту нову пару токенів.

Після успішного refresh клієнт повинен замінити обидва токени:

```txt
old accessToken  → new accessToken
old refreshToken → new refreshToken
```

Старий refresh token більше не можна використовувати.

## Token family

При login або register створюється окрема refresh-token family.

У межах однієї family активним є тільки останній refresh token.

```txt
login
  ↓
refresh token A
  ↓ refresh
refresh token B
  ↓ refresh
refresh token C
```

Якщо вже використаний token `A` буде відправлений повторно, система розглядає це як можливий replay attack і відкликає всю family.

Після цього актуальний token `C` також перестає працювати, а користувач повинен виконати login повторно.

## Redis state

Redis використовується для:

- зберігання активного refresh token;
- зберігання поточного token ID для family;
- атомарної rotation;
- blacklist відкликаних access token-ів.

Основні ключі:

```txt
auth:refresh-token:<refresh-jti>
auth:refresh-family:<family-id>
auth:revoked-access-token:<access-jti>
```

Усі ключі мають TTL.

## JWT logout

Для повного logout рекомендовано передати:

```http
POST /auth/logout
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "refreshToken": "<current-refresh-token>"
}
```

Під час logout сервер:

1. перевіряє refresh token;
2. відкликає refresh-token family;
3. перевіряє access token, якщо він переданий;
4. додає access token у blacklist до завершення його строку дії.

Logout може працювати навіть без чинного access token. У такому випадку буде відкликана refresh-token family.

## Session mode

У session-режимі сервер створює сесію в Redis і встановлює cookie:

```txt
sid=<session-id>
```

Cookie має використовувати:

```txt
httpOnly=true
sameSite=lax
secure=true у production
path=/
```

Під час logout Redis-сесія видаляється, а cookie очищується.

# 17. Outbox

Outbox потрібен для надійної доставки domain events.

Без outbox може бути проблема:

```txt
1. User створився в DB
2. API впав до відправки email/event
3. Event втрачено
```

З outbox:

```txt
1. User створився в DB
2. Event записався в outbox_events
3. Якщо worker/queue впали — event залишився pending
4. Cron/worker повторить доставку
```

Це особливо важливо для:

- email;
- webhook;
- notifications;
- integrations;
- billing;
- audit events.

---

# 18. Idempotency

Idempotency потрібна для захисту від повторного виконання однієї і тієї ж операції.

Приклади:

- користувач двічі натиснув кнопку оплати;
- frontend повторив POST-запит;
- webhook provider прислав однаковий event кілька разів;
- worker повторно виконав critical job.

API може приймати header:

```txt
Idempotency-Key: unique-request-key
```

Якщо такий key уже був виконаний, система може повернути попередній response, а не створювати дубль.

---

# 19. Заборонені імпорти

## 19.1. Domain

`domain` не може імпортувати:

```txt
@nestjs/*
drizzle-orm
ioredis
bullmq
express
fastify
config
logger
infrastructure
```

## 19.2. Application

`application` не може імпортувати:

```txt
infrastructure
drizzle-orm
ioredis
bullmq
HTTP controllers
```

Application працює через contracts.

## 19.3. Infrastructure

`infrastructure` може імпортувати:

```txt
domain
application contracts
contracts
shared
external libraries
```

## 19.4. Apps

`apps/*` можуть імпортувати:

```txt
application
infrastructure
contracts
shared
```

Але apps не повинні містити бізнес-логіку.

---

# 20. Testing strategy

Обовʼязкові типи тестів:

```txt
domain unit tests
use-case unit tests
repository integration tests
cache integration tests
queue integration tests
health endpoint test
idempotency tests
transaction tests
```

## 20.1. Domain unit tests

Перевіряють чисту бізнес-логіку без NestJS.

Приклад:

```txt
User.create()
User.depositBalance()
EmailVO validation
```

## 20.2. Use-case unit tests

Use-case тестується з mocked contracts.

Наприклад:

```ts
const userRepository = mock<IUserRepository>();
const eventBus = mock<IEventBus>();

const useCase = new CreateUserUseCase(userRepository, eventBus);
```

## 20.3. Repository integration tests

Перевіряють реальну роботу repository з PostgreSQL/Drizzle.

## 20.4. Cache integration tests

Перевіряють Redis cache:

```txt
get
set
remember
TTL
forgetByPattern
```

## 20.5. Queue integration tests

Перевіряють:

```txt
add job
process job
retry
delayed job
```

## 20.6. Transaction tests

Перевіряють:

```txt
commit
rollback
repository inside transaction
```

---

# 21. Environment variables

Приклад `.env`:

```env
NODE_ENV=development
APP_PORT=3000

DATABASE_URL=postgresql://app:app@localhost:5432/app

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

BULLMQ_DEFAULT_ATTEMPTS=3
BULLMQ_BACKOFF_DELAY=5000

MAIL_DRIVER=null
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

STORAGE_DRIVER=local
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

AUTH_DRIVER=jwt
AUTH_SESSION_TTL_SECONDS=604800

JWT_SECRET=dev-access-secret-change-me
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=dev-refresh-secret-change-me
JWT_REFRESH_EXPIRES_IN=7d

PASSWORD_SALT_ROUNDS=10

RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100

LOGGER_LEVEL=debug
```

Для Docker:

```env
DATABASE_URL=postgresql://app:app@postgres:5432/app
REDIS_HOST=redis
```

---

# 22. Graceful shutdown

Усі entrypoint-и мають підтримувати graceful shutdown.

Для API:

- закрити HTTP server;
- закрити DB pool;
- закрити Redis connections.

Для Worker:

- завершити активні jobs;
- закрити BullMQ workers;
- закрити Redis;
- закрити DB pool.

Для Cron:

- не стартувати нові jobs;
- завершити активний job;
- закрити Redis;
- закрити DB pool.

---

# 23. Definition of Done

Проєкт вважається готовим, якщо:

- є окремі apps: `api`, `worker`, `cron`;
- є всі обовʼязкові libs;
- `domain` — pure TypeScript;
- `application` не залежить від `infrastructure`;
- PostgreSQL + Drizzle працює;
- Redis працює;
- BullMQ працює;
- є cache module;
- є mail module;
- є storage module;
- є health checks;
- є exception filter;
- є transaction manager;
- є event bus;
- є outbox;
- є audit;
- є rate limiter;
- є distributed lock;
- є idempotency;
- є приклад `users` feature;
- є Docker Compose;
- є README;
- є базові тести;
- graceful shutdown реалізований для API, Worker, Cron;
- немає circular dependencies;
- немає імпортів `infrastructure` у `domain/application`.

---

# 24. Рекомендований порядок роботи в новому проєкті

1. Скопіювати starter.
2. Перейменувати package/project.
3. Налаштувати `.env`.
4. Запустити PostgreSQL і Redis.
5. Запустити міграції.
6. Перевірити `/health`.
7. Додати першу бізнес-feature.
8. Описати domain entity.
9. Описати repository contract.
10. Написати use-cases.
11. Реалізувати repository в infrastructure.
12. Додати controller.
13. Додати tests.
14. Додати queue/cron, якщо потрібно.
15. Запустити lint/test/build.

---

# 25. Корисні команди

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run start:dev:api
```

```bash
npm run start:dev:worker
```

```bash
npm run start:dev:cron
```

```bash
npm run lint
```

```bash
npm run format
```

```bash
npm run test
```

```bash
npm run db:generate
```

```bash
npm run db:migrate
```

```bash
docker compose up -d --build
```

```bash
docker compose logs -f api
```

---

# 26. Головна ідея

Цей starter має дозволити починати новий backend-проєкт не з налаштування Redis, PostgreSQL, queues, config, logger, transactions, idempotency, health checks і Docker, а одразу з бізнес-логіки.

Архітектура спеціально побудована так, щоб:

- бізнес-логіка не залежала від інфраструктури;
- інфраструктуру можна було замінювати;
- API, Worker і Cron запускались окремо;
- модулі можна було переносити між проєктами;
- нові features додавались за зрозумілим шаблоном;
- проєкт залишався підтримуваним при рості.

## Тести

```bash
npm run test:unit
npm run test:int
npm run lint
```
