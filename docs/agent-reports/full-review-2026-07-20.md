# Full review — NestJS Backend Foundation Starter

Date: 2026-07-20  
Scope: full-repository portability / architecture review (read-only)  
Focus: what is still missing for portable modules + overall score

---

## 1. Межі перевірки

**Документи прочитані:**

- `README.md`
- `MODULES_OVERVIEW_NON_TECH.md`
- `EXAMPLES.md`
- `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`
- `AGENTS.md`
- `docs/infrastructure-modules/README.md`

**Команди:**

```text
Команда: npm run build
Результат: exit 0 (api, worker, cron, migrations)
Висновок: збірка проходить

Команда: npm run lint
Результат: exit 0
Висновок: ESLint чистий

Команда: npm run test:unit
Результат: 35 suites / 206 tests passed, exit 0
Висновок: unit gate зелений
```

**Entrypoint:** composition корені `ApiModule` / worker / cron переглянуті статично. Повний live bootstrap усіх entrypoint у цій сесії не повторювався (Docker Compose вже був запущений у середовищі користувача).

**Не підтверджено:** `npm run test:int`, production multi-instance Outbox race, SMTP/S3 live adapters.

---

## 2. Критичні та високі проблеми

Critical runtime defects у цій перевірці не підтверджені.

### [High][Confirmed defect] LoggerModule непереносний: немає forRoot і жорстко залежить від AppConfigService

**Доказ:**

- `libs/infrastructure/src/logger/logger.module.ts` — статичний `@Module`, імпортує `InfrastructureConfigModule`
- `libs/infrastructure/src/logger/app-logger.service.ts` — конструктор інжектить `AppConfigService` і читає `config.logger().level` / `.pretty`
- `RedisModule`, `MailModule`, `AuditModule`, `ExceptionsModule` імпортують `LoggerModule`

**Що зараз не так:**

Будь-який consumer Redis/Mail/Audit тягне валідований env-конфіг стартера через logger.

**Чому це проблема:**

Порушує `.cursor/rules/20-module-portability.mdc` («must not require AppConfigService as its only configuration API»). Модуль не можна підключити в інший проєкт лише з typed options.

**Що потрібно змінити:**

`LoggerModule.forRoot` / `forRootAsync({ level, pretty })`; `AppLogger` приймає options token, не `AppConfigService`. Mapping — лише в composition root.

---

### [High][Confirmed defect] RateLimiterGuard defaults прив’язані до AppConfigService

**Доказ:**

- `libs/infrastructure/src/rate-limiter/rate-limiter.guard.ts` — `this.config.rateLimit().max/ttl/authMax/authTtl`
- `RateLimiterModule.register` приймає лише `imports`, без typed defaults
- `apps/api/src/api.module.ts` передає `InfrastructureConfigModule` у `RateLimiterModule.register`

**Що потрібно змінити:**

Typed `RateLimiterModule.register({ imports, defaults: { max, ttl, authMax, authTtl } })` і options provider замість `AppConfigService` у guard.

---

### [High][Confirmed defect] EventsModule зашиває бізнес-handler UserRegistered

**Доказ:**

- `libs/infrastructure/src/events/events.module.ts` — hard-register `UserRegisteredEventHandler` як єдиний `TOKENS.DomainEventHandlers`
- `OutboxProcessorModule.buildFeatureImports` завжди додає `EventsModule.register` + `AuditModule` + `LoggerModule`

**Чому це проблема:**

Інфраструктурний Events/Outbox невіддільний від sample Auth/User welcome-email логіки. Перенесення Outbox у чужий проєкт тягне starter-specific handler.

**Що потрібно змінити:**

`EventsModule.register({ handlers: [...] })` або composition-root provider override; Outbox не повинен auto-імпортувати sample handlers.

---

### [High][Architectural risk] Немає publishable packages / extraction story

**Доказ:**

- root `package.json`: `"private": true`, немає `workspaces` / `publishConfig`
- немає `libs/*/package.json`
- reuse = copy/archive (`scripts/release/*`), не `npm install`

**Чому це проблема:**

«Переносний модуль» у сенсі npm-бібліотеки відсутній. Досяжна модель — fork/copy starter і selective imports.

---

## 3. Середні та низькі проблеми

### [Medium][Confirmed defect] HealthModule жорстко вимагає Postgres + Redis + OUTBOX queue

`health.module.ts` inject: `DRIZZLE_DB`, `REDIS_CLIENT`, `getQueueToken(QUEUES.OUTBOX)`. Worker-only / Redis-only / DB-only health неможливі без фейкових токенів.

### [Medium][Confirmed defect] Feature modules (`Cache`, `Locks`, `Idempotency`, …) — лише `register({ imports })`

Немає typed TTL/key-policy/driver options на межі модуля. HTTP idempotency TTL hardcoded `86400` у interceptor.

### [Medium][Architectural risk] `InfrastructureConfigModule` робить `ConfigModule` global

`isGlobal: true` приховує залежність від env validation для будь-якого імпортера.

### [Medium][Architectural risk] Auth product stack прив’язаний до User entity

`AuthModule` (tokens/stores) відносно портабельний; application use cases + `RepositoriesModule` (лише `UserDrizzleRepository`) + Events handler — ні.

### [Low] Deprecated `forRootFromAppConfig` і `InfrastructureModule.forRoot` facade

Залишаються footgun для copy-paste інтеграторів.

### [Low–Medium] Відсутні очікувані «nice-to-have» для foundation

OpenTelemetry/metrics/tracing, SMS port/adapter, multi-tenancy, feature flags, circuit breakers — не заявлені як готові модулі в README starter feature list (крім generic foundation claims у review checklist).

---

## 4. Невідповідності документації

**Документація заявляє** (`docs/infrastructure-modules/README.md` L3): кожен reusable infrastructure module exposes typed `forRoot` / `forRootAsync`.

**Фактична реалізація:** Logger/Exceptions — static; Cache/Locks/Idempotency/RateLimiter/Events/Audit/Transactions/Repositories — `register` без typed runtime options; Health — `register`/`registerAsync` з вузькими options.

**Потрібно змінити:** документацію (і/або API модулів), щоб матриця registration була правдивою.

Також EXAMPLES §13 і docs перелічують лише connection modules як portable examples — це узгоджується з кодом краще, ніж загальне твердження L3.

---

## 5. Непідтверджені області

- Integration tests (`test:int`) у цій сесії не запускались.
- Live SMTP/S3/Google OAuth.
- Multi-instance Outbox reclaim під навантаженням.
- Повний Docker rebuild verification (compose вже був up у середовищі користувача).

---

## 6. Підсумкова оцінка

## Підсумкова оцінка: 8.0/10

Сильна onion + multi-entrypoint основа з typed `forRoot` на Redis/Drizzle/BullMQ/Auth/Mail/Storage/Outbox. Build/lint/unit зелені; Domain/Application без Nest/ORM leakage. Не 10/10 через системні portability gaps у cross-cutting модулях і відсутність npm extraction.

**Чому не 10/10:**

1. `LoggerModule` / cascade AppConfig через Redis/Mail/Audit/Exceptions.
2. `RateLimiterGuard` defaults через `AppConfigService`.
3. `EventsModule` + Outbox зашивають UserRegistered sample business.
4. Немає publishable packages — лише copy/fork.
5. Docs overclaim `forRoot` для всіх reusable modules; Health некомпозитний.

---

## 7. Що обов’язково зробити для 10/10

1. **LoggerModule.forRoot(options)** — прибрати `AppConfigService` з `AppLogger`; оновити Redis/Mail/Audit/Exceptions consumers.
2. **RateLimiter typed defaults** — прибрати `AppConfigService` з guard.
3. **Events/Outbox composability** — handlers реєструються з composition root; sample UserRegistered лишається в apps/example, не в infra EventsModule.
4. **Health pluggable checks** — optional providers замість fixed DRIZZLE+REDIS+OUTBOX.
5. **Portability contract** — вирівняти docs; або publishable workspace packages, або явно документувати «copy-kit, not npm libs».
6. **Feature module options** — TTL/prefix/defaults для Cache/Idempotency/Locks на межі `register`.
7. **Видалити або ізолювати deprecated facades** (`forRootFromAppConfig`, `InfrastructureModule.forRoot`) після migration window.
