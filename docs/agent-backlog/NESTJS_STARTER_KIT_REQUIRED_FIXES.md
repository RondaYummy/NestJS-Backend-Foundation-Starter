# NestJS Starter Kit — обов’язкові виправлення

> **Актуалізовано:** 22 червня 2026 року  
> **Перевірений baseline:** `NestJS-Backend-Foundation-Starter(51).zip`  
> **Призначення:** доказовий statement of work для агентів, які планують, реалізують і незалежно перевіряють виправлення.

Цей файл замінює попередній backlog для baseline `(45)` і є єдиним актуальним source of truth для issue IDs. Нові задачі з review baseline `(51)` додані як `P1-06`, `P1-07`, `P2-12`–`P2-15` та `P3-04`; дублікати оновлені у вже наявних пунктах.

## Правила роботи агента

1. Працювати лише над одним ID за раз.
2. Перед плануванням повторно підтвердити, що дефект існує в поточній гілці.
3. Прочитати весь dependency/runtime flow, а не лише файл з локальним симптомом.
4. Для зміни token/port/module перевірити всі providers, exports, imports і consumers.
5. Не позначати задачу виконаною лише через успішний build.
6. Не виконувати migration, destructive SQL, видалення volumes або зміни production secrets без явного дозволу людини.
7. Implementation дозволена лише для plan зі `status: approved`.
8. Після реалізації потрібен окремий незалежний verification report.
9. Не використовувати `any`, `@ts-ignore`, вимкнення lint rules або послаблення validation як заміну виправленню.
10. Якщо код і документація суперечать одне одному, не вважати документацію автоматично правильною.

---

# 1. Межі перевірки

## Прочитана документація

Повністю прочитані:

- `README.md`;
- `MODULES_OVERVIEW_NON_TECH.md`;
- `EXAMPLES.md`;
- `PROMPT(6).md` як обов’язковий review rubric;
- `AGENTS.md`;
- `CURSOR_AGENT_ARCHITECTURE.md`;
- `.cursor/agents/*`, `.cursor/commands/*`, `.cursor/rules/*`, `.cursor/skills/*`.

## Проінвентаризовано

- `package.json`, `package-lock.json`, package manager та engines;
- `tsconfig*`, `nest-cli.json`;
- `Dockerfile`, `docker-compose*`, `.dockerignore`, `.env.example`;
- API, Worker, Cron і Migrations entrypoint;
- root/composition modules;
- Drizzle schema та migrations;
- Domain/Application/Contracts/Infrastructure/Interface boundaries;
- injection tokens, providers, imports, exports і dynamic modules;
- Auth, Redis, BullMQ, PostgreSQL/Drizzle, Outbox, Email, Storage, Health та migrations flow.

## Виконані команди

### Clean install

```text
Команда: npm ci --no-audit --no-fund
Результат: exit code 0.
Додатково: npm надрукував EBADENGINE для lint-staged@17.0.7, який вимагає Node >=22.22.1; review environment мав Node 22.16.0.
Висновок: залежності встановлюються, але package.json engines допускає непідтримувану minor-версію Node.
```

### Build

```text
Команда: npm run build:api
Результат: exit code 0.
Висновок: API компілюється.

Команда: npm run build:worker
Результат: exit code 0.
Висновок: Worker компілюється.

Команда: npm run build:cron
Результат: exit code 0.
Висновок: Cron компілюється.

Команда: npm run build:migrations
Результат: exit code 0.
Висновок: Migrations компілюється.

Команда: npm run build
Результат: дві спроби не завершилися до timeout review environment.
Висновок: aggregate command не підтверджено; це не класифіковано як дефект, бо всі чотири окремі build-команди проходять.
```

### TypeScript typecheck

```text
Команди:
- npx tsc -p apps/api/tsconfig.app.json --noEmit --pretty false
- npx tsc -p apps/worker/tsconfig.app.json --noEmit --pretty false
- npx tsc -p apps/cron/tsconfig.app.json --noEmit --pretty false
- npx tsc -p apps/migrations/tsconfig.app.json --noEmit --pretty false

Результат: усі exit code 0.
Висновок: окремі entrypoint-и проходять typecheck.
```

### Lint

```text
Команда: npm run lint
Результат: exit code 1, 4 non-formatting errors.
Файли:
- libs/infrastructure/src/outbox/outbox-processor.defaults.ts
- libs/infrastructure/src/outbox/outbox-processor.options.schema.ts
Висновок: lint gate поточного baseline не проходить; див. P2-11.
```

### Runtime bootstrap

Локально піднято Redis на `127.0.0.1:6380`; процеси завершувалися контрольованим timeout після bootstrap.

```text
Команда: npm run start:prod:api
Результат: Nest application і HTTP routes успішно ініціалізовані; завершено timeout після перевірки startup.
Висновок: DI/bootstrap API не падає.

Команда: npm run start:prod:worker
Результат: усі modules ініціалізовані; log містив "Worker application started successfully"; завершено timeout.
Висновок: DI/bootstrap Worker не падає.

Команда: npm run start:prod:cron
Результат: усі modules ініціалізовані; завершено timeout.
Висновок: DI/bootstrap Cron не падає.
```

Migrations runtime не запускався, оскільки безпечний PostgreSQL instance у середовищі рев’ю був відсутній.

### Unit tests

```text
Команда: npm run test:unit -- --runInBand
Результат: не завершилася до 240-second timeout; ts-jest надрукував warning про module=Node16 та isolatedModules.
Висновок: test suite не підтверджено; timeout не використовується як окремий defect у підсумковій оцінці, але має бути розібраний у V-14.
```

### Production dependency audit

```text
Команда: npm audit --omit=dev --audit-level=high
Результат: exit code 1; 8 high, 0 critical.
Основні advisory paths: multer через @nestjs/platform-express та nodemailer.
Висновок: production dependency graph потребує окремого безпечного upgrade plan; див. P2-09.
```

### Docker

```text
Команда: docker --version / docker compose startup
Результат: Docker CLI/daemon недоступний у review environment.
Висновок: Docker startup flow не підтверджено; див. V-13.
```

---

# 2. Пріоритетний backlog

## P1 — High

| ID      | Classification                              | Назва                                                                                   |
| ------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `P1-01` | Confirmed defect                            | Закрити path traversal у `LocalStorageAdapter`                                          |
| `P1-02` | Confirmed defect                            | Додати error boundary та overlap guard для Cron tick                                    |
| `P1-03` | Confirmed defect                            | Посилити production policy для JWT secrets                                              |
| `P1-04` | Architectural risk                          | Зробити infrastructure modules незалежно конфігурованими й явно скомпонованими          |
| `P1-05` | Architectural risk + Documentation mismatch | Прибрати NestJS DI decorators з Application або офіційно змінити архітектурний контракт |
| `P1-06` | Confirmed defect                            | Виправити DI visibility для `TOKENS.UserRepository` в API Auth composition              |
| `P1-07` | Confirmed defect                            | Зробити `AuthModule.forRoot()` явним щодо Redis dependency та незалежного reuse         |

## P2 — Medium

| ID      | Classification         | Назва                                                                          |
| ------- | ---------------------- | ------------------------------------------------------------------------------ |
| `P2-01` | Likely defect          | Серіалізувати паралельні PostgreSQL migrations                                 |
| `P2-02` | Confirmed defect       | Узгодити `QueueJobRegistry`, `QUEUES` та BullMQ registrations                  |
| `P2-03` | Confirmed defect       | Реалізувати справжній `forgetByPattern()`                                      |
| `P2-04` | Confirmed defect       | Не reclaim-ити Outbox event, поки timeouted handler продовжує side effect      |
| `P2-05` | Architectural risk     | Додати bounded deadlines до readiness checks                                   |
| `P2-06` | Confirmed defect       | Не авторизовувати користувача лише за stale token/session claims               |
| `P2-07` | Confirmed defect       | Обробляти `complete() === false` після email side effect                       |
| `P2-08` | Confirmed defect       | Прибрати другий `process.env` configuration path для Outbox Worker concurrency |
| `P2-09` | Confirmed defect       | Усунути high advisories у production dependency graph                          |
| `P2-10` | Confirmed defect       | Не включати `.env` і `.git` у release archive                                  |
| `P2-11` | Confirmed defect       | Відновити non-formatting lint gate                                             |
| `P2-12` | Documentation mismatch | Узгодити register flow з auth token/session документацією                      |
| `P2-13` | Architectural risk     | Винести Outbox scheduler options із `OutboxProcessorModule` для Cron           |
| `P2-14` | Architectural risk     | Додати централізований Redis namespace/key prefix                              |
| `P2-15` | Confirmed defect       | Виправити `release:check` false-positive secret scan                           |

## P3 — Low

| ID      | Classification          | Назва                                                                                 |
| ------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `P3-01` | Confirmed defect        | Узгодити Node engine range з dependency requirements                                  |
| `P3-02` | Documentation mismatch  | Синхронізувати README з чотирма entrypoint, фактичними features та EventBus semantics |
| `P3-03` | Documentation mismatch  | Виправити `.env.example` і component-specific startup logging                         |
| `P3-04` | Production/tooling risk | Ізолювати unit suite timeout та open handles                                          |

---

# 3. Критичні та високі проблеми

## P1-01. Закрити path traversal у `LocalStorageAdapter`

**Severity:** High  
**Classification:** Confirmed defect

### Доказ

- `libs/infrastructure/src/storage/local-storage.adapter.ts`
- symbol: `LocalStorageAdapter.path()`

```ts
private path(key: string): string {
  return join(this.config.storage().localPath, key);
}
```

`key` передається в `putObject`, `getObject`, `deleteObject` та `getSignedUrl` без normalization/containment validation.

### Що зараз не так

Ключ на кшталт `../outside.txt`, абсолютний шлях або platform-specific traversal може резолвитися поза `LOCAL_STORAGE_PATH`.

### Чому це проблема

Consumer, який передає user-controlled object key, може читати, створювати або видаляти файли з правами Node process поза storage root.

### Dependency/runtime flow

```text
Controller/use case
  -> TOKENS.StorageGateway
    -> LocalStorageAdapter
      -> path.join(configuredRoot, untrustedKey)
        -> fs read/write/rm outside configuredRoot
```

### Що потрібно змінити

1. Резолвити absolute storage root один раз.
2. Нормалізувати key у platform-neutral form.
3. Заборонити empty key, absolute path, `..`, null byte та escape за root.
4. Після `resolve(root, key)` перевіряти containment через `relative(root, candidate)`.
5. Не повертати absolute filesystem path як public URL, якщо API контракт очікує URL.
6. Додати negative tests для POSIX і Windows-style separators.

### Приклад коду

`libs/infrastructure/src/storage/local-storage.adapter.ts`

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

private path(key: string): string {
  if (!key || key.includes('\0') || isAbsolute(key)) {
    throw new Error('Invalid storage key');
  }

  const root = resolve(this.config.storage().localPath);
  const candidate = resolve(root, key.replaceAll('\\', '/'));
  const rel = relative(root, candidate);

  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Storage key escapes configured root');
  }

  return candidate;
}
```

### Acceptance criteria

- `../x`, `..\\x`, `/tmp/x`, `C:\\x`, encoded/normalized traversal відхиляються;
- nested key `users/123/avatar.png` працює;
- write/read/delete не виходять за root;
- lint, typecheck і targeted tests проходять.

---

## P1-02. Додати error boundary та overlap guard для Cron tick

**Severity:** High  
**Classification:** Confirmed defect

### Доказ

- `apps/cron/src/schedules/outbox.schedule.ts`
- symbols: `OutboxSchedule.onModuleInit()`, `OutboxSchedule.tick()`

```ts
const interval = setInterval(() => {
  void this.tick();
}, this.options.pollIntervalMs);
```

`tick()` може reject через Redis distributed lock або BullMQ enqueue. Promise навмисно відкидається через `void`, але `.catch()` відсутній.

### Що зараз не так

Transient Redis/BullMQ failure створює unhandled rejection. Залежно від Node/runtime policy це може завершити Cron process або залишити помилку без керованого structured log. Також локальний `setInterval` може почати наступний tick, поки попередній ще очікує I/O; distributed lock не замінює local overlap protection всередині одного process.

### Dependency/runtime flow

```text
setInterval callback
  -> OutboxSchedule.tick()
    -> IDistributedLock.runWithLock()
      -> IQueueGateway.add()
        -> rejected promise
          -> no local catch/error boundary
```

### Що потрібно змінити

1. Додати wrapper `runTickSafely()` з `try/catch` і structured logging.
2. Додати локальний `isTickRunning`/single-flight guard.
3. Не зупиняти наступні ticks після transient failure.
4. Окремо логувати `lock not acquired` як normal skip, якщо adapter це підтримує.
5. На shutdown не запускати нові ticks і коректно прибирати interval.

### Приклад коду

`apps/cron/src/schedules/outbox.schedule.ts`

```ts
private tickRunning = false;
private shuttingDown = false;

onModuleInit(): void {
  const interval = setInterval(() => {
    void this.runTickSafely();
  }, this.options.pollIntervalMs);

  this.schedulerRegistry.addInterval(OUTBOX_SCHEDULE_INTERVAL_NAME, interval);
}

onModuleDestroy(): void {
  this.shuttingDown = true;
  this.schedulerRegistry.deleteInterval(OUTBOX_SCHEDULE_INTERVAL_NAME);
}

private async runTickSafely(): Promise<void> {
  if (this.shuttingDown || this.tickRunning) return;

  this.tickRunning = true;
  try {
    await this.tick();
  } catch (error: unknown) {
    this.logger.error({ error }, 'Outbox cron tick failed');
  } finally {
    this.tickRunning = false;
  }
}
```

### Acceptance criteria

- rejected lock/queue call не створює unhandled rejection;
- process залишається живим і наступний tick виконується;
- одночасно в одному process працює не більше одного tick;
- multi-instance protection залишається через distributed lock.

---

## P1-03. Посилити production policy для JWT secrets

**Severity:** High  
**Classification:** Confirmed defect

### Доказ

- `libs/infrastructure/src/config/env.schema.ts`
- fields: `JWT_SECRET`, `JWT_REFRESH_SECRET`

```ts
JWT_SECRET: z.string().min(1),
JWT_REFRESH_SECRET: z.string().min(1),
```

Для production допускається односимвольний secret, однакові access/refresh secrets і очевидні placeholder values.

### Що зараз не так

Schema перевіряє лише непорожність. Це створює слабку криптографічну конфігурацію, хоча bootstrap формально успішний.

### Що потрібно змінити

1. У production вимагати щонайменше 32 random bytes у printable/base64/hex representation.
2. Заборонити access secret, рівний refresh secret.
3. Заборонити відомі placeholder values: `secret`, `changeme`, `development`, sample values із docs.
4. Документувати безпечну генерацію secrets без додавання реального значення в repository.
5. Зберегти прості test defaults лише в test-specific setup, не в production schema.

### Приклад коду

`libs/infrastructure/src/config/env.schema.ts`

```ts
if (env.NODE_ENV === 'production') {
  for (const field of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[field].trim();
    if (value.length < 43 || /^(secret|changeme|development)$/i.test(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} must contain at least 32 bytes of non-placeholder entropy`,
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

### Acceptance criteria

- production bootstrap відхиляє короткі, placeholder та однакові secrets;
- valid independently generated secrets проходять;
- dev/test policy явно задокументована;
- secrets не логуються у validation errors.

---

## P1-04. Зробити infrastructure modules незалежно конфігурованими й явно скомпонованими

**Severity:** High  
**Classification:** Architectural risk

### Доказ

- `libs/infrastructure/src/config/infrastructure-config.module.ts`: один `ConfigModule.forRoot({ isGlobal: true, validate: envSchema })` для всього starter kit;
- `libs/infrastructure/src/redis/redis.module.ts`: `@Global()` і hard dependency на `AppConfigService`;
- `libs/infrastructure/src/database/drizzle/drizzle.module.ts`: `@Global()` і hard dependency на `AppConfigService`;
- `libs/infrastructure/src/bullmq/bullmq.module.ts`: `@Global()`, реєструє всі queues;
- `libs/infrastructure/src/auth/auth.module.ts`: `@Global()`, створює JWT і Session implementations;
- `libs/infrastructure/src/repositories/repositories.module.ts`, `transactions.module.ts`: `@Global()`;
- `libs/infrastructure/src/mail/mail.module.ts` та `storage/storage.module.ts`: одночасно створюють усі provider adapters, після чого factory обирає один;
- лише `OutboxProcessorModule` має повноцінні `forRoot/forRootAsync` contracts.

### Що зараз не так

Окремий модуль не можна перенести або підключити без монолітного `AppConfigService`, global config schema та часто без непотрібних adapters/queues. Entry points отримують приховані providers через global modules. Це суперечить заявленій переносимості й ускладнює independent deployment.

### Чому це проблема

- модуль не має явного public configuration contract;
- API/Worker/Cron важче мінімізувати;
- tests і downstream projects повинні відтворювати весь global config;
- заміна Redis, Queue, Auth, Mail або Storage adapter вимагає редагування internal module;
- обидва mutually-exclusive adapters можуть мати constructor dependencies і startup side effects.

### Цільовий dependency flow

```text
Entrypoint composition root
  -> Feature/adapter module.forRootAsync(...)
    -> typed module options token
      -> exactly one selected adapter
        -> exported provider token
```

### Що потрібно змінити

Розбити роботу на окремі approved plans, не робити один великий rewrite:

1. `RedisModule.forRoot/forRootAsync` з `RedisModuleOptions` і explicit exports.
2. `DrizzleModule.forRoot/forRootAsync` з connection/pool options.
3. `BullMqModule.forRootAsync` + `registerQueues(...)` лише для потрібних queues.
4. `AuthModule.forRootAsync` має створювати лише обрану strategy й adapter dependencies.
5. `MailModule.forRootAsync` та `StorageModule.forRootAsync` мають реєструвати один selected adapter через provider factory/dynamic imports.
6. Зняти `@Global()` там, де немає доказаної потреби.
7. Розділити env validation за module/entrypoint; root composition може map-ити `ConfigService` у typed options.
8. Оновити API/Worker/Cron root modules так, щоб dependencies були видимі в `imports`.
9. Зберегти compatibility facade лише тимчасово й позначити migration path.

### Приклад public contract

`libs/infrastructure/src/redis/redis.module.ts`

```ts
export interface RedisModuleOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  connectTimeoutMs?: number;
  keyPrefix?: string;
}

@Module({})
export class RedisModule {
  static forRootAsync(options: {
    imports?: ModuleMetadata['imports'];
    inject?: InjectionToken[];
    useFactory: (...deps: never[]) => Promise<RedisModuleOptions> | RedisModuleOptions;
  }): DynamicModule {
    return {
      module: RedisModule,
      imports: options.imports,
      providers: [
        {
          provide: REDIS_MODULE_OPTIONS,
          inject: options.inject,
          useFactory: options.useFactory,
        },
        redisClientProvider,
        RedisService,
      ],
      exports: [REDIS_CLIENT, RedisService],
    };
  }
}
```

### Acceptance criteria

- кожен reusable module має typed sync/async configuration;
- module можна підключити в isolated Nest testing module без `InfrastructureConfigModule`;
- лише selected Auth/Mail/Storage adapter створюється;
- composition roots явно імпортують потрібні dependencies;
- API не реєструє Worker consumers; Cron не запускає Worker consumers; Worker не створює HTTP server;
- docs містять standalone integration example для кожного модуля.

---

## P1-05. Прибрати NestJS DI decorators з Application або офіційно змінити архітектурний контракт

**Severity:** High  
**Classification:** Architectural risk + Documentation mismatch

### Доказ

Application use cases імпортують NestJS:

- `libs/application/src/use-cases/auth/register.usecase.ts`;
- `login.usecase.ts`;
- `logout.usecase.ts`;
- `refresh-auth-session.usecase.ts`;
- `get-current-user.usecase.ts`.

Вони використовують `@Injectable()` та `@Inject(TOKENS.*)` з `@nestjs/common`.

Водночас review baseline вимагає framework-independent Application і dependency direction через ports. `AGENTS.md` визнає current exception, а README в різних місцях одночасно описує Application як framework-independent і допускає decorators.

### Що зараз не так

Use cases залежать від Nest container metadata. Їх не можна інстанціювати як plain Application classes без NestJS package, а composition responsibility частково перенесена всередину Application layer.

### Чому це проблема

Для reusable Onion/Clean starter це системне boundary violation: framework concern проникає у use cases, ускладнює reuse в CLI/other framework та робить архітектурні правила неоднозначними для агентів.

### Цільовий dependency flow

```text
Nest composition module
  -> provider factory
    -> new RegisterUseCase(userRepo, passwordHasher, tx, outbox)

Application use case
  -> constructor interfaces/ports only
  -> no @nestjs imports
```

### Що потрібно змінити

Обрати один контракт і зафіксувати ADR:

**Рекомендований варіант:**

1. Прибрати `@Injectable`/`@Inject` з Application classes.
2. Залишити constructor parameters typed ports/classes.
3. У `apps/api/src/composition/auth-application.module.ts` створити explicit factory providers для use cases.
4. Tokens використовувати лише в composition/infrastructure boundary.
5. Додати import-boundary lint rule: `libs/application/**` не імпортує `@nestjs/*`.
6. Оновити README, AGENTS і Cursor rules.

Альтернативно можна офіційно дозволити Nest DI decorators у Application, але тоді не називати Application framework-independent і послабити відповідний architecture requirement у всіх джерелах. Для starter kit цей варіант менш бажаний.

### Приклад коду

`libs/application/src/use-cases/auth/login.usecase.ts`

```ts
export class LoginUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly passwords: IPasswordHasher,
    private readonly authTokens: IAuthTokenService,
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
    passwords: IPasswordHasher,
    authTokens: IAuthTokenService,
  ) => new LoginUseCase(users, passwords, authTokens),
}
```

### Acceptance criteria

- `rg "@nestjs" libs/application/src` не знаходить imports;
- use cases unit-instantiable без Nest testing module;
- всі constructor dependencies реєструються у composition root;
- документація й agent rules описують один контракт без винятків.

---

## P1-06. Виправити DI visibility для `TOKENS.UserRepository` в API Auth composition

**Severity:** High  
**Classification:** Confirmed defect

### Доказ

- `apps/api/src/composition/auth-application.module.ts`
- symbol: `AuthApplicationCompositionModule.register(...)`
- `AuthModule.forRootAsync(...)` отримує:

```ts
imports: [InfrastructureConfigModule, redisModule],
inject: [AppConfigService, TOKENS.UserRepository],
```

- `RepositoriesModule.register({ imports: [drizzleModule] })` імпортується лише як sibling module у `AuthApplicationCompositionModule`, але не передається в `imports` самого `AuthModule.forRootAsync(...)` / nested `JwtModule.registerAsync(...)`.
- Runtime DI reproduction через isolated Nest testing module для API auth composition дає помилку виду:

```text
Nest can't resolve dependencies of the JWT_MODULE_OPTIONS (AppConfigService, ?).
Please make sure that the argument Symbol(IUserRepository) at index [1] is available in the JwtModule module.
```

### Що зараз не так

`TOKENS.UserRepository` використовується factory для auth options, але provider, який експортує цей token, не є видимим у module context, де Nest створює `JWT_MODULE_OPTIONS`.

### Чому це проблема

API може успішно компілюватися, але падати при реальному runtime bootstrap після успішного Redis/PostgreSQL startup. Це ламає основний Auth flow starter kit.

### Dependency/runtime flow

```text
ApiModule
  -> AuthApplicationCompositionModule.register(...)
    -> AuthModule.forRootAsync(...)
      -> JwtModule.registerAsync(...)
        -> JWT_MODULE_OPTIONS
          -> inject AppConfigService + TOKENS.UserRepository
            -> TOKENS.UserRepository не видимий у imports AuthModule/JwtModule
```

### Що потрібно змінити

1. У `apps/api/src/composition/auth-application.module.ts` створити один dynamic module instance для repositories:
   - `const repositoriesModule = RepositoriesModule.register({ imports: [drizzleModule] })`.
2. Передати `repositoriesModule` у `AuthModule.forRootAsync({ imports: [...] })`.
3. Використати той самий `repositoriesModule` у `return imports` composition module.
4. Додати regression bootstrap/DI test, який створює `AuthApplicationCompositionModule.register(...)` і підтверджує, що `JWT_MODULE_OPTIONS` резолвиться.
5. Оновити documentation/example composition, якщо там показаний старий pattern.

### Приклад коду

`apps/api/src/composition/auth-application.module.ts`

```ts
const repositoriesModule = RepositoriesModule.register({
  imports: [drizzleModule],
});

const authModule = AuthModule.forRootAsync({
  imports: [InfrastructureConfigModule, redisModule, repositoriesModule],
  inject: [AppConfigService, TOKENS.UserRepository],
  useFactory: (config: AppConfigService, users: IUserRepository) => {
    const base = mapAppConfigToAuthOptions(config);
    const resolveFreshUser = buildFreshUserResolver(users);

    return base.driver === 'session'
      ? { ...base, resolveSessionUser: resolveFreshUser }
      : { ...base, resolveAccessUser: resolveFreshUser };
  },
});

return {
  module: AuthApplicationCompositionModule,
  imports: [
    ...(options.imports ?? []),
    InfrastructureConfigModule,
    redisModule,
    drizzleModule,
    authModule,
    repositoriesModule,
    TransactionsModule.register({ imports: [drizzleModule] }),
    OutboxWriterModule.register({ imports: [drizzleModule] }),
  ],
};
```

### Acceptance criteria

- API auth composition bootstrap проходить без DI помилки для `TOKENS.UserRepository`;
- `JWT_MODULE_OPTIONS` резолвиться у Nest runtime;
- `RepositoriesModule.register(...)` не створюється двічі для одного composition root без потреби;
- `npm run build:api`, API typecheck і targeted DI test проходять.

---

## P1-07. Зробити `AuthModule.forRoot()` явним щодо Redis dependency та незалежного reuse

**Severity:** High  
**Classification:** Confirmed defect

### Доказ

- `libs/infrastructure/src/auth/auth.module.ts`
- symbol: `AuthModule.forRoot(options)`
- `forRoot(...)` імпортує лише `JwtModule.register(...)`, але `buildSyncDriverProviders(...)` реєструє Redis-backed stores:
  - `RedisJwtTokenStore`;
  - `RedisSessionStore`.
- `RedisJwtTokenStore` і `RedisSessionStore` інжектять `RedisService`, але `RedisModule` не є import contract для sync registration.
- Runtime reproduction `AuthModule.forRoot(...)` в isolated Nest testing module без `RedisModule` дає DI помилку виду:

```text
Nest can't resolve dependencies of the RedisJwtTokenStore (?).
Please make sure that the argument RedisService at index [0] is available in the AuthModule module.
```

### Що зараз не так

Публічний sync API `AuthModule.forRoot(...)` виглядає самодостатнім, але приховано потребує Redis provider. Consumer не має typed способу передати required infrastructure dependency у `forRoot(...)`.

### Чому це проблема

Це порушує переносимість starter kit modules: модуль не можна безпечно використати незалежно від root app/global modules, а dependency visibility залежить від зовнішньої випадкової composition.

### Dependency/runtime flow

```text
ConsumerModule
  -> AuthModule.forRoot(...)
    -> RedisJwtTokenStore або RedisSessionStore
      -> RedisService
        -> RedisModule не імпортований у AuthModule.forRoot(...)
```

### Що потрібно змінити

1. Додати sync registration contract, який приймає `imports?: ModuleMetadata['imports']`, або deprecated sync API замінити на `forRootAsync` з explicit imports.
2. Розділити auth core від Redis stores, якщо потрібна заміна storage adapter:
   - `AuthModule`;
   - `AuthRedisStoreModule` або provider token для `JwtTokenStore`/`SessionStore`.
3. Не створювати Redis-backed store, якщо consumer передав інший implementation через token.
4. Оновити `README.md`, `EXAMPLES.md` і composition examples.

### Приклад коду

`libs/infrastructure/src/auth/auth.module.ts`

```ts
export interface AuthModuleRegistrationOptions {
  imports?: ModuleMetadata['imports'];
}

static forRoot(
  options: AuthModuleOptions,
  registration: AuthModuleRegistrationOptions = {},
): DynamicModule {
  const imports: ModuleMetadata['imports'] = [...(registration.imports ?? [])];

  if (isJwtAuthOptions(options)) {
    imports.push(JwtModule.register({ secret: options.jwt.secret }));
  }

  return {
    module: AuthModule,
    global: false,
    imports,
    providers: [
      { provide: AUTH_MODULE_OPTIONS, useValue: options },
      ...AuthModule.buildSharedProviders(),
      ...AuthModule.buildSyncDriverProviders(options),
    ],
    exports: AuthModule.buildExports(options),
  };
}
```

### Acceptance criteria

- `AuthModule.forRoot(authOptions, { imports: [redisModule] })` bootstrap проходить;
- `AuthModule.forRoot(authOptions)` без required store dependency або fail-fast має зрозумілу validation error, або більше не підтримується як public API;
- Redis dependency видно у composition root;
- docs не показують прихований global dependency pattern.

---

# 4. Середні та низькі проблеми

## P2-01. Серіалізувати паралельні PostgreSQL migrations

**Severity:** Medium  
**Classification:** Likely defect

### Доказ

- `apps/migrations/src/main.ts`
- `migrate(db, { migrationsFolder })` викликається без PostgreSQL advisory lock або іншого deployment-level mutex.

Drizzle веде migration journal, але в коді starter kit немає явного контракту, що два migration jobs не стартують одночасно.

### Ризик

Під час rolling deployment або двох CI jobs можливі конкурентні DDL operations, lock contention та нестабільний startup. Runtime не підтверджено через відсутність PostgreSQL у review environment, тому classification — Likely defect.

### Що потрібно змінити

- отримати dedicated connection;
- виконати `pg_advisory_lock(<stable-id>)` перед `migrate()`;
- у `finally` виконати unlock і release;
- додати bounded lock wait/statement timeout;
- задокументувати, що migrations — one-shot deployment job, а не side effect API startup;
- додати integration scenario з двома паралельними processes.

---

## P2-02. Узгодити `QueueJobRegistry`, `QUEUES` та BullMQ registrations

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- `libs/contracts/src/queues/queue-names.ts` оголошує 9 queues;
- `libs/contracts/src/queues/queue-gateway.ts` містить payload registry лише для `email` та `outbox`;
- `QueueName = keyof QueueJobRegistry`, тому інші сім queues не є valid typed queue names;
- `libs/infrastructure/src/bullmq/bullmq.module.ts` реєструє ширший набір queues.

### Що зараз не так

Public constants, compile-time contract і runtime registrations описують різні множини queue. README instructions про додавання queue/job можуть привести до compile error або до runtime queue без typed payload.

### Що потрібно змінити

Обрати один з двох варіантів:

1. Видалити placeholder queues, поки для них немає job contracts/consumers.
2. Або розширити `QueueJobRegistry` module augmentation/central registry і реєструвати queue лише у відповідних composition roots.

`BullQueueGateway` має реалізовувати точний generic contract, а не послаблювати параметри до `string` усередині public implementation signature.

---

## P2-03. Реалізувати справжній `forgetByPattern()`

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- `libs/infrastructure/src/cache/redis-cache.gateway.ts`

```ts
async forgetByPattern(pattern: string): Promise<void> {
  await this.redis.del(this.prefix + pattern);
}
```

Redis `DEL app:user:*` видаляє literal key, а не keys, що відповідають pattern.

### Що потрібно змінити

- або перейменувати метод на `del()` і прибрати неправдиву pattern semantics;
- або реалізувати cursor-based `SCAN MATCH app:<pattern> COUNT <batch>` + batched `UNLINK/DEL`;
- не використовувати blocking `KEYS`;
- prefix застосовувати рівно один раз;
- визначити behavior під час concurrent key creation.

---

## P2-04. Не reclaim-ити Outbox event, поки timeouted handler продовжує side effect

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts`
- symbol: handler timeout path біля `Promise.race(...)`.

Timeout reject не скасовує original handler Promise. Catch path може викликати `markFailed()`, очистити ownership/heartbeat і зробити event доступним для retry, поки перший handler ще виконує зовнішній side effect.

### Ризик

Два execution можуть одночасно виконувати один integration side effect. At-least-once допускає повтор, але не виправдовує керований concurrent retry до завершення попереднього execution.

### Що потрібно змінити

- передавати handler-у `AbortSignal` і вимагати cooperative cancellation; або
- не release-ити event до фактичного завершення handler; або
- застосувати fencing token/idempotency key на downstream side effect;
- задокументувати handler contract;
- додати scenario: timeout -> handler продовжує -> інший worker claim.

---

## P2-05. Додати bounded deadlines до readiness checks

**Severity:** Medium  
**Classification:** Architectural risk

### Доказ

- `libs/infrastructure/src/health/health.service.ts`
- `Promise.all([db.execute, redis.ping, queue.getJobCounts])` без per-check timeout.

### Ризик

Якщо dependency connection зависає довше за load balancer/Kubernetes timeout, readiness endpoint теж зависає й накопичує requests.

### Що потрібно змінити

- typed `HEALTH_CHECK_TIMEOUT_MS`;
- timeout wrapper або Terminus indicators з timeout;
- `Promise.allSettled`/ізольоване status mapping;
- не логувати credentials/connection string;
- readiness має bounded response time навіть під outage.

---

## P2-06. Не авторизовувати користувача лише за stale token/session claims

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- `libs/infrastructure/src/auth/jwt-auth-token.service.ts`: verified claims повертаються як current user після blacklist check;
- `refresh` видає нові tokens на основі старих claims/roles;
- `libs/infrastructure/src/auth/redis-session-store.service.ts`: session зберігає serialized `CurrentUser`;
- User schema/entity не має `disabled`, `authVersion` або equivalent revocation version.

### Що зараз не так

Role removal, user disable/delete або security reset не обов’язково набуває чинності до expiration. Refresh може переносити stale roles у новий token.

### Що потрібно змінити

- визначити authorization freshness policy;
- мінімум під час refresh завантажувати current user/roles з repository;
- додати `authVersion`/`tokenVersion` або session invalidation strategy;
- для high-risk endpoints опційно перевіряти актуальний user state;
- session може зберігати user ID + version замість довгоживучого role snapshot;
- задокументувати maximum revocation delay.

---

## P2-07. Обробляти `complete() === false` після email side effect

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- `apps/worker/src/processors/email.processor.ts`;
- `IJobExecutionStore.complete()` повертає `Promise<boolean>`;
- result після send не перевіряється.

### Що зараз не так

Якщо ownership lease втрачено після фактичного email send, `complete()` поверне false, але processor завершить job як success. Пізніше execution key може зникнути, і retry/recreated job повторно відправить email.

### Що потрібно змінити

- перевірити return value;
- при false підняти explicit `ExecutionOwnershipLostError` або записати durable ambiguous outcome;
- визначити crash-window policy;
- використовувати provider idempotency key, якщо provider підтримує;
- не стверджувати exactly-once delivery.

---

## P2-08. Прибрати другий `process.env` configuration path для Outbox Worker concurrency

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- `apps/worker/src/processors/outbox.processor.ts`:

```ts
@Processor(QUEUES.OUTBOX, buildOutboxProcessorDecoratorOptions())
```

- `libs/infrastructure/src/outbox/outbox-processor.defaults.ts` читає `process.env` під час decorator evaluation;
- parse failure тихо повертає defaults;
- `WorkerModule` окремо передає options через `OutboxProcessorModule.forRootAsync()` та `AppConfigService`.

### Що зараз не так

Concurrency і processor service можуть отримати options із різних paths. Invalid env для decorator silently fallback-иться, тоді як root config може fail-fast або мати інше значення.

### Що потрібно змінити

- один typed source of truth;
- не читати `process.env` у reusable decorator helper;
- реєструвати processor metadata через module options/worker factory, або чітко відокремити static bootstrap config з fail-fast parse;
- не ковтати validation error;
- видалити dead imports/constants, які зараз ламають lint.

---

## P2-09. Усунути high advisories у production dependency graph

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

`npm audit --omit=dev --audit-level=high`:

```text
8 high, 0 critical
```

Зокрема:

- `multer` через `@nestjs/platform-express` — DoS advisories;
- `nodemailer` — raw message option advisory, пов’язаний з file access/SSRF.

### Що потрібно змінити

1. Не запускати `npm audit fix --force` без review.
2. Визначити patched versions та compatibility з NestJS 11.
3. Оновити direct/transitive dependencies у окремому approved dependency plan.
4. Перевірити upload endpoints/limits та чи передається user-controlled raw mail payload.
5. Повторити build, lint, unit/int і runtime bootstrap.
6. Якщо patch ще недоступний, документувати exploitability, compensating controls і expiry date exception.

---

## P2-10. Не включати `.env` і `.git` у release archive

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

Перевірений ZIP містить:

```text
.env
.git/
```

`.env` не tracked Git-ом, але все одно потрапив у distribution. `.git` містить history/config/remotes metadata й суттєво збільшує artifact.

### Що потрібно змінити

- створювати release archive з allowlist через `git archive` або окремий packaging script;
- ніколи не включати `.env`, private keys, dumps, `node_modules`, `.git`;
- включати лише `.env.example` з non-secret placeholders;
- додати secret scanner і artifact manifest check у CI;
- перевірити Docker build context через `.dockerignore`.

---

## P2-11. Відновити non-formatting lint gate

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

`npm run lint` повертає exit code 1:

- unused `computeHandlerTimeoutMs`;
- unused `computeLockHeartbeatIntervalMs`;
- unused `defaultLockTtlMs`;
- unused `lockTtlMs`.

Файли:

- `libs/infrastructure/src/outbox/outbox-processor.defaults.ts`;
- `libs/infrastructure/src/outbox/outbox-processor.options.schema.ts`.

### Що потрібно змінити

Видалити dead symbols або завершити intended validation calculation. Не перейменовувати на `_` лише для обходу lint, якщо значення мало використовуватися. Після зміни виконати lint і outbox option tests.

---

## P3-01. Узгодити Node engine range з dependency requirements

**Severity:** Low  
**Classification:** Confirmed defect

### Доказ

- `package.json`: `node: ">=22 <25"`;
- `lint-staged@17.0.7`: engine `>=22.22.1`;
- `npm ci` під Node 22.16.0 формально дозволений repository engine, але дає `EBADENGINE` dependency warning.

### Що потрібно змінити

- підняти minimum Node до `>=22.22.1 <25`, або pin/replace dependency, сумісну з нижчою Node 22;
- синхронізувати Docker base image, CI matrix, `.nvmrc`/Volta/asdf і docs.

---

## P3-02. Синхронізувати README з фактичними entrypoint, features та EventBus semantics

**Severity:** Low  
**Classification:** Documentation mismatch

### Документація заявляє

- у кількох місцях описано три runtime entrypoint;
- users feature і balance-like examples подані як готова структура/usage;
- в одному розділі EventBus описано як наявний generic module, а в іншому — як відсутній;
- scripts excerpt неповний щодо Migrations.

### Фактична реалізація

- є чотири entrypoint: API, Worker, Cron, Migrations;
- demo business feature — Auth/User, а частина users/balance paths у README відсутня;
- є domain event router/handlers, але не універсальний async integration EventBus;
- `build:migrations`, `start:prod:migrations`, `db:migrate:prod` існують.

### Потрібно змінити

- чітко відділити “implemented” від “example to create”;
- використовувати реальні paths;
- описати DomainEventRouter semantics і не називати його ширшим EventBus без контракту;
- документувати всі чотири entrypoint та deployment model.

---

## P3-03. Виправити `.env.example` і component-specific startup logging

**Severity:** Low  
**Classification:** Documentation mismatch

### Доказ

- `.env.example` містить дубльовані/коментовані Outbox variables з різними naming variants;
- Redis startup helper використовує log prefix `[worker-startup]`, хоча викликається також API/Cron.

### Що потрібно змінити

- залишити по одному canonical env key;
- прибрати obsolete aliases або документувати migration;
- передавати component name у startup probe або використовувати нейтральний prefix `[redis-startup]`.

---

## P2-12. Узгодити register flow з auth token/session документацією

**Severity:** Medium  
**Classification:** Documentation mismatch

### Документація заявляє

`README.md` описує, що при `login` або `register` створюється окрема refresh-token family / auth session family.

### Фактична реалізація

- `apps/api/src/controllers/auth.controller.ts`
  - `login(...)` викликає `LoginUseCase.execute(...)` і `SessionCookieService.attachIfNeeded(...)`.
  - `register(...)` викликає тільки `RegisterUseCase.execute(...)` і повертає результат без auth/session handling.
- `libs/application/src/use-cases/auth/register.usecase.ts`
  - створює user;
  - пише `UserRegisteredEvent` в outbox;
  - не інжектить `AuthTokenService` / `AuthSessionService`;
  - не повертає `auth` object.

### Що зараз не так

Документація створює очікування auto-login після registration, але фактичний register endpoint повертає лише user payload.

### Чому це проблема

Інтегратор може побудувати frontend/API contract навколо неіснуючого auth result після register. Це особливо критично для session driver, де cookie attach відбувається лише в login flow.

### Що потрібно змінити

Обрати один контракт:

1. **Register не логінить користувача** — оновити `README.md`, `EXAMPLES.md`, OpenAPI/examples і явно показати flow `register -> login`.
2. **Register логінить користувача** — змінити code path:
   - додати auth service dependency у register application flow або orchestration use case;
   - повертати `{ user, auth }`;
   - викликати `SessionCookieService.attachIfNeeded(...)` у controller;
   - додати idempotency/transaction boundary decision для user write + auth side effect.

### Acceptance criteria

- документація і runtime response для `POST /auth/register` збігаються;
- session і jwt driver мають однаковий documented contract;
- examples не обіцяють refresh/session family там, де код її не створює.

---

## P2-13. Винести Outbox scheduler options із `OutboxProcessorModule` для Cron

**Severity:** Medium  
**Classification:** Architectural risk

### Доказ

- `apps/cron/src/cron.module.ts`
- `CronModule` імпортує:
  - `drizzleModule`;
  - `OutboxProcessorModule.forRootAsync(...)`;
  - `bullMqQueuesModule`.
- `apps/cron/src/schedules/outbox.schedule.ts`
  - інжектить `IQueueGateway`, `IDistributedLock`, `OutboxProcessorOptions`, `SchedulerRegistry`;
  - не читає outbox table напряму;
  - лише enqueue-ить `QUEUES.OUTBOX` job.

### Що зараз не так

Cron composition root підключає повний outbox processor / DB-related stack, хоча scheduler потребує лише queue, lock і options provider.

### Чому це проблема

Це не доведена runtime-помилка, але порушує multi-entrypoint мінімальність і portability. Cron deployment отримує зайву залежність від DB/outbox processor composition, хоча фактична відповідальність Cron — поставити job у чергу.

### Dependency/runtime flow

```text
CronModule
  -> OutboxProcessorModule.forRootAsync(...)
    -> Drizzle/outbox processor infrastructure
CronSchedule фактично потребує:
  -> TOKENS.QueueGateway
  -> TOKENS.DistributedLock
  -> TOKENS.OutboxProcessorOptions
```

### Що потрібно змінити

1. Створити lightweight options module/provider, наприклад:
   - `OutboxProcessorOptionsModule`;
   - або `OutboxSchedulerConfigModule`.
2. У `apps/cron/src/cron.module.ts` прибрати `OutboxProcessorModule` і `drizzleModule`, якщо Cron не виконує DB reads/writes.
3. Залишити лише:
   - `ScheduleModule`;
   - config module;
   - logger;
   - Redis/locks;
   - BullMQ connection + outbox queue registration;
   - options provider.
4. Оновити docs про Cron як thin scheduler.

### Acceptance criteria

- `CronModule` bootstrap не потребує Drizzle/DB, якщо scheduler тільки enqueue-ить queue job;
- `OutboxSchedule` отримує той самий typed `OutboxProcessorOptions` без імпорту processor module;
- Worker залишається єдиним entrypoint, який імпортує actual outbox processor;
- `npm run build:cron` і Cron DI test проходять.

---

## P2-14. Додати централізований Redis namespace/key prefix

**Severity:** Medium  
**Classification:** Architectural risk

### Доказ

- `libs/infrastructure/src/redis/redis.module.ts` / Redis options не мають `keyPrefix`, `namespace` або `projectPrefix`.
- `libs/infrastructure/src/redis/redis.service.ts` приймає raw keys і передає їх у Redis без централізованої нормалізації.
- Prefixes формуються локально в adapters/features, зокрема:
  - cache: `app:`;
  - locks: `lock:${key}`;
  - jwt/session auth: `auth:*`;
  - job execution: `job-execution:*`;
  - rate limiter / idempotency keys.

### Що зараз не так

Redis key namespace розкиданий по реалізаціях і не конфігурується як частина reusable module contract.

### Чому це проблема

Кілька проєктів, environments або deployments на одному Redis DB можуть перетинатися ключами. Для зміни namespace потрібно редагувати внутрішній код adapters, що суперечить portability вимогам starter kit.

### Що потрібно змінити

1. Додати env/config поле, наприклад `REDIS_KEY_PREFIX` або `APP_NAMESPACE`.
2. Додати `keyPrefix?: string` у `RedisModuleOptions`.
3. Централізувати key building:
   - або в `RedisService`;
   - або через окремий `RedisKeyBuilder` provider.
4. Заборонити feature adapters самостійно створювати global project prefix; вони можуть додавати лише local segment після namespace.
5. Оновити docs і examples для multi-project Redis usage.

### Acceptance criteria

- усі Redis keys проходять через один namespace builder;
- namespace можна змінити без редагування feature adapter code;
- default namespace безпечний для local dev і явно задокументований;
- tests покривають cache/lock/auth/job-execution/rate-limit key construction.

---

## P2-15. Виправити `release:check` false-positive secret scan

**Severity:** Medium  
**Classification:** Confirmed defect

### Доказ

- Команда `npm run release:check` створює release archive, але verify step падає через secret-pattern findings у `scripts/release/release-policy.spec.ts`.
- Test fixture містить рядки, які імітують AWS access key / private key block, а `scripts/release/verify-archive.ts` сканує їх як potential secrets.

### Що зараз не так

Release quality gate блокується власними test fixtures, тобто starter kit не має стабільного підтвердженого release flow.

### Чому це проблема

Навіть якщо runtime build/typecheck проходять, інтегратор не може отримати clean release artifact через офіційну команду перевірки. Це delivery defect для reusable starter kit.

### Що потрібно змінити

1. Не включати `*.spec.ts` / test fixtures у release archive, якщо вони не потрібні runtime consumer-у.
2. Або додати вузький allowlist тільки для конкретного fixture path.
3. Або переписати fixtures так, щоб вони не містили literal secret patterns.
4. Перевірити, що `P2-10` залишається окремим artifact hygiene gate для `.env`, `.git`, private files.

### Acceptance criteria

- `npm run release:check` проходить на clean tree;
- release scanner все ще ловить реальні `.env`, private keys і secrets;
- test fixtures не потрапляють у release artifact або мають безпечний allowlist;
- policy test і release verify не суперечать одне одному.

---

## P3-04. Ізолювати unit suite timeout та open handles

**Severity:** Low  
**Classification:** Production/tooling risk

### Доказ

- `npm run test:unit -- --runInBand` не завершився в review timeout.
- Частина suites проходить, але повний unit command не дав завершеного verdict.
- `jest.unit.config.ts` має широкий `testMatch`, через що unit command може включати важчі bootstrap/integration-style specs.

### Що зараз не так

Unit command не є передбачуваним швидким gate для агентів і CI. Це не враховується як defect через сам факт наявності/відсутності тестів, але tooling flow потребує стабілізації.

### Чому це проблема

Агенти можуть не мати надійного локального verification loop. Open handles у Redis/BullMQ/Drizzle specs можуть маскувати lifecycle defects або робити CI flaky.

### Що потрібно змінити

1. Розділити Jest configs:
   - pure unit;
   - integration/bootstrap;
   - release-policy.
2. Знайти open handles через `--detectOpenHandles` / targeted binary search.
3. Закривати Redis/BullMQ/Drizzle/Nest application contexts у `afterEach/afterAll`.
4. Обмежити `testMatch` для unit лише тестами без зовнішньої інфраструктури.
5. Оновити verification instructions у `V-14`.

### Acceptance criteria

- `npm run test:unit -- --runInBand` стабільно завершується;
- integration/bootstrap specs винесені в окремий command;
- немає dangling Redis/BullMQ/Nest handles після test run;
- agents мають швидкий documented local verification loop.

---

# 5. Невідповідності документації

Не створювати дублікати окремих багів. Виправляти разом із відповідним ID:

| Невідповідність                                                                        | Пов’язаний ID    |
| -------------------------------------------------------------------------------------- | ---------------- |
| Framework-independent Application vs фактичні Nest decorators і документований виняток | `P1-05`          |
| “Незалежні reusable modules” vs global monolithic config/composition                   | `P1-04`          |
| Три entrypoint vs фактичні чотири                                                      | `P3-02`          |
| Users/balance paths подані як готові, але відсутні                                     | `P3-02`          |
| Generic EventBus vs фактичний DomainEventRouter                                        | `P3-02`          |
| Pattern invalidation docs vs literal `DEL`                                             | `P2-03`          |
| Queue extension instructions vs неповний typed registry                                | `P2-02`          |
| Idempotency wording не повинно обіцяти exactly-once                                    | `P2-04`, `P2-07` |
| Register documentation promises auth/session family, але endpoint повертає лише user   | `P2-12`          |
| Cron описаний як thin scheduler, але composition імпортує processor/DB stack           | `P2-13`          |

---

# 6. Непідтверджені області

1. **PostgreSQL migrations runtime і concurrency** — безпечний PostgreSQL instance був відсутній.
2. **Docker development/production startup** — Docker CLI/daemon був недоступний.
3. **SMTP/S3 provider integration** — зовнішні services/credentials не використовувалися.
4. **Aggregate `npm run build`** — не завершився до tool timeout; окремі builds проходять.
5. **Unit suite completion** — не завершилася до 240-second timeout.
6. **Long-running graceful shutdown active BullMQ jobs** — bootstrap перевірено, active-job SIGTERM scenario не виконано.
7. **Actual Cursor UI execution of project commands/subagents** — конфігурацію проаналізовано статично, але команди не запускалися всередині Cursor runtime.

Не перетворювати ці пункти на Confirmed defect без окремого відтворення.

---

# 7. Verification backlog

| ID     | Що перевірити                                                                      |
| ------ | ---------------------------------------------------------------------------------- |
| `V-01` | Clean install, aggregate/individual build, four typechecks, lint, production audit |
| `V-02` | API/Worker/Cron/Migrations bootstrap із documented minimal env                     |
| `V-03` | LocalStorage traversal negative matrix                                             |
| `V-04` | Cron transient Redis/BullMQ failure, no unhandled rejection, no local overlap      |
| `V-05` | Production JWT weak/equal/placeholder secrets fail-fast                            |
| `V-06` | Two parallel migration processes serialize safely                                  |
| `V-07` | Queue registry compile-time/runtime parity                                         |
| `V-08` | Redis pattern invalidation via SCAN without blocking KEYS                          |
| `V-09` | Outbox timeout does not produce overlapping side effects                           |
| `V-10` | Readiness returns within configured deadline under dependency hangs                |
| `V-11` | Role revoke/user disable/authVersion/session invalidation                          |
| `V-12` | Email ownership loss after provider send                                           |
| `V-13` | Docker dev/prod flows and release artifact manifest/secrets                        |
| `V-14` | Unit suite timeout/root cause and ts-jest configuration                            |
| `V-15` | Active BullMQ job graceful shutdown under SIGTERM                                  |
| `V-16` | API Auth composition resolves `TOKENS.UserRepository` inside Auth/JWT registration |
| `V-17` | `AuthModule.forRoot` independent registration with explicit Redis dependency       |
| `V-18` | Register endpoint response matches documented auth/session behavior                |
| `V-19` | Cron composition does not import DB/outbox processor when only enqueueing jobs     |
| `V-20` | Redis keys use configured global namespace/key prefix                              |
| `V-21` | `npm run release:check` passes while still catching real secret artifacts          |

Кожен verification report має містити:

```text
Issue ID:
Command/scenario:
Expected result:
Actual result:
Exit code:
Evidence:
Verdict: approved | changes-required | not-confirmed
Unverified areas:
```

---

# 8. Вже реалізовано — не виконувати повторно

## R-01. User write + Outbox write в одній transaction

`RegisterUseCase` використовує transaction manager і передає transaction context у repository/outbox writer. Не розривати цю атомарність.

## R-02. Outbox row claim і renewable ownership

`DrizzleOutboxProcessor` уже має claim flow з `FOR UPDATE SKIP LOCKED`/ownership fields, lease renewal heartbeat і conditional mark operations. Відкритою залишається лише timeout/cancellation race у `P2-04`.

## R-03. Email execution renewable lease

`RedisJobExecutionStore` уже має ownership token, `extend`, compare-and-set `complete` і compare-and-delete `release`. Відкритою залишається обробка `complete() === false` у `P2-07`.

## R-04. Multi-entrypoint bootstrap separation

- Worker створюється через `createApplicationContext`, без HTTP server;
- Cron окремий process;
- Migrations окремий one-shot entrypoint;
- API/Worker/Cron Nest DI bootstrap успішний з локальним Redis.

Не об’єднувати entrypoint-и назад в один runtime process.

---

# 9. Підсумкова оцінка

## Підсумкова оцінка: 7.2/10

Оцінка базується на фактичному коді та виконаних командах. Відсутність тестів як така і formatting/Prettier не враховувалися.

### Чому не 10/10

1. API Auth composition має підтверджену DI visibility проблему для `TOKENS.UserRepository`.
2. `AuthModule.forRoot()` приховано залежить від Redis і не є самодостатнім independent module contract.
3. Cron composition root тягне зайвий OutboxProcessor/DB stack для thin scheduler сценарію.
4. Redis namespace/key prefix не централізовано конфігурується.
5. Залишаються release/tooling/documentation risks, включно з `release:check` false-positive scan.

---

# 10. Що обов’язково зробити для 10/10

1. **Runtime і DI:** `P1-06`, `P1-07`; додати targeted API/Auth DI bootstrap verification.
2. **Runtime і security:** `P1-01`, `P1-02`, `P1-03`.
3. **Portability/composition:** `P1-04`, `P2-13`; зробити typed dynamic modules і explicit imports у `apps/*/*.module.ts`.
4. **Dependency direction:** `P1-05`; перенести Nest DI wiring у composition roots.
5. **Data integrity/side effects:** `P2-01`, `P2-04`, `P2-07`.
6. **Authorization freshness:** `P2-06`.
7. **Contracts/configuration:** `P2-02`, `P2-03`, `P2-08`, `P2-14`.
8. **Production readiness:** `P2-05`, `P2-09`, `P2-10`, `P2-11`, `P2-15`, `P3-01`, `P3-04`.
9. **Documentation:** `P2-12`, `P3-02`, `P3-03` і всі linked mismatch rows.
10. **Independent verification:** виконати `V-01`–`V-21` і не закривати непідтверджені сценарії лише статичним review.

---

# 11. Статусна модель

```text
open backlog issue
  -> proposed plan
  -> human-approved plan
  -> implementation report
  -> independent verification
  -> human acceptance
```

Рекомендовані paths:

```text
docs/agent-plans/<ID>-<slug>.md
docs/agent-reports/<ID>-implementation.md
docs/agent-reports/<ID>-verification.md
```

Backlog/INDEX не можна використовувати для заяви про “resolved” без implementation і verification evidence.
