# NestJS Backend Foundation Starter — Full Architecture Review

**Date:** 2026-08-02  
**Branch:** `main` @ `aad6f2f`  
**Scope:** Full-repository review of current branch  
**Mode:** READ-ONLY (no production code changes)  
**Reviewer:** architecture-reviewer + nestjs-starter-review skill  
**Rubric:** `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`

---

### 1. Межі перевірки

**Прочитані обов’язкові документи:**
1. `README.md`
2. `MODULES_OVERVIEW_NON_TECH.md`
3. `EXAMPLES.md`
4. `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`
5. `AGENTS.md`

**Інвентаризація:** `package.json` / lockfile, `nest-cli.json`, tsconfigs, Docker/`docker-compose.yml`, `.env.example`, entrypoints (`api` / `worker` / `cron` / `migrations`), composition modules, `TOKENS`, infrastructure dynamic modules, Drizzle/outbox/auth/mail/redis/bullmq, Domain/Application/Contracts boundaries.

**Внутрішня DI-карта (скорочено):**

```text
api  -> ApiModule -> Config/Logger/Redis/Drizzle/BullMQ(OUTBOX,EMAIL)/Idempotency/Health/RateLimiter
                 -> AuthApplicationCompositionModule -> Auth/GoogleSso/Repos/Tx/OutboxWriter + use-case factories
worker -> WorkerModule -> Config/Logger/Redis/Drizzle/BullMQ/Mail/Idempotency/OutboxProcessor(+Events/Audit) + EmailProcessor
cron   -> CronModule -> Config/Logger/Redis/BullMQ(OUTBOX)/Locks/OutboxProcessorOptions + OutboxSchedule
migrations -> runMigrations() + advisory lock (no Nest DI)
```

**Entrypoint bootstrap:** `npm run start:api` — fail-fast на відсутньому Redis (очікувана помилка інфраструктури). Worker/Cron/Migrations live runtime — **Не підтверджено** (немає Redis/PostgreSQL; Docker daemon недоступний).

---

### Команди (Command / Result / Conclusion)

```text
Команда: git status / git branch / git log -5
Результат: main @ aad6f2f; backlog empty (no open defects); working tree reviewed as full-repo on current branch
Висновок: Full-repo review поточної гілки.

Команда: npm run build
Результат: exit 0 (api + worker + cron + migrations) — підтверджено architecture-reviewer
Висновок: TypeScript/Nest compile OK для всіх entrypoints. Повторний build у parent session був заблокований auto-review.

Команда: npm run lint
Результат: exit 0 (--max-warnings=0)
Висновок: Немає type/architecture lint дефектів (formatting-only не застосовувалось).

Команда: npm run test:unit
Результат: 43 suites / 274 tests passed
Висновок: Unit gate зелений. (У логах є очікувані ERROR з mock health/rate-limiter у HTTP specs.)

Команда: npm run test:int
Результат: 4 suites / 8 tests passed; warning про open handles / force exit (architecture-reviewer)
Висновок: Exit 0, але outbox int-specs skip-ають тіло тестів коли PostgreSQL недоступний — gate не доводить runtime інтеграцію.

Команда: npm run test:module
Результат: 1 failed (CronModule), 13 passed; Tests 1 failed / 29 passed
Висновок: Підтверджений дефект verification gate (див. Medium #1). Повторно підтверджено в parent session.

Команда: npm run start:api
Результат: Redis unavailable after 5 startup attempts → process exit 1 (architecture-reviewer)
Висновок: Fail-fast Redis startup працює; повний HTTP bootstrap не підтверджено (немає Redis). Проєктний дефект ≠ відсутня інфра.

Команда: Test-NetConnection localhost:5432 / :6379; docker ps
Результат: postgres=False, redis=False; Docker engine pipe missing (architecture-reviewer)
Висновок: Інфраструктура локально недоступна; int/bootstrap обмежені.

Команда: npm run test:all / test:release
Результат: Не виконано повністю (auto-review / scope)
Висновок: Не підтверджено в цій сесії; test:module уже fail → test:all ймовірно fail.
```

---

### 2. Критичні та високі проблеми

**Critical:** немає підтверджених.

**High:** немає підтверджених (немає доведеного runtime/DI падіння entrypoint або data-corruption path на живій інфрі; відсутній Redis/Postgres відокремлено від дефектів проєкту).

---

### 3. Середні та низькі проблеми

### [Medium][Confirmed defect] `CronModule` module-spec ламає `test:module` через несумісний mock `ioredis` з BullMQ

**Доказ:**
- `apps/cron/src/cron.module.spec.ts` — `jest.mock('ioredis', () => jest.fn().mockImplementation(...))`
- `npm run test:module` → `TypeError: ioredis_1.default is not a constructor` у `bullmq/.../redis-connection.js` під час `Test.createTestingModule({ imports: [CronModule] })`
- 13 інших `*.module.spec.ts` пройшли

**Що зараз не так:**  
Mock експортує конструктор без CJS `.default`, який очікує BullMQ (`require('ioredis').default`). RedisModule path може «проковтнути» mock через ESM default import, але BullMQ queue bootstrap — ні.

**Чому це проблема:**  
`AGENTS.md` / `test:all` включає `test:module` як DI/bootstrap gate. Merge-ready перевірка entrypoint Cron зараз червона навіть без реальної інфри.

**Dependency/runtime flow:**

```text
CronModule
  -> InfrastructureBullMqModule.registerQueues([OUTBOX])
    -> BullModule.registerQueue
      -> BullMQ Queue -> require('ioredis').default  // FAIL under current mock
```

**Що потрібно змінити:**  
Вирівняти mock з BullMQ (надати `{ __esModule: true, default: RedisMock }`) або override BullMQ connection/providers у тесті, щоб не піднімати реальний Queue Redis client.

**Точні зміни:**
1. `apps/cron/src/cron.module.spec.ts` — виправити `jest.mock('ioredis')` (і за потреби shared test helper).
2. Перевірити інші specs з тим самим mock-патерном під повним BullMQ bootstrap.
3. `npm run test:module` → green.

**Приклад коду:**

```text
apps/cron/src/cron.module.spec.ts
```

```ts
jest.mock('ioredis', () => {
  const RedisMock = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    status: 'ready',
    // …мінімум методів, які викликає BullMQ
  }));
  return { __esModule: true, default: RedisMock };
});
```

---

### [Medium][Confirmed defect] Integration tests мовчки skip-ають при відсутньому PostgreSQL, але `test:int` лишається green

**Доказ:**
- `libs/infrastructure/src/outbox/drizzle-outbox-processor.int-spec.ts` — `isPostgresAvailable()`; при `false` — `console.warn` + early `return` у `it(...)` без `fail`/`describe.skip`
- `npm run test:int` → 8 passed при `postgres=False` на localhost
- Warning: worker force-exited (open handles)

**Що зараз не так:**  
Відсутність інфри виглядає як успішний інтеграційний прогон.

**Чому це проблема:**  
CI/агент можуть «підтвердити» outbox lease/heartbeat поведінку без жодного реального DB assert.

**Що потрібно змінити:**  
Fail-closed або explicit skip reporting: `describe.skip` / exit non-zero / required `INTEGRATION=1` env, і окремий status у summary.

**Точні зміни:**
1. Усі `*.int-spec.ts` з availability probe.
2. `jest.integration.config.ts` або wrapper script для fail-on-skip policy.
3. Документувати в `AGENTS.md` / README.

---

### [Medium][Confirmed defect] Docker runtime Node 24 розходиться з `.nvmrc` / CI Node 22.22.1

**Доказ:**
- `Dockerfile`: `FROM node:24-bookworm-slim AS base`
- `.nvmrc`: `22.22.1`
- `.github/workflows/release-artifact.yml`: `node-version-file: '.nvmrc'`
- `package.json` engines: `>=22.22.1 <25` (обидва валідні, але різні major)

**Що зараз не так:**  
Local/CI і production image використовують різні major Node.

**Чому це проблема:**  
Ризик «працює в CI / ламається в контейнері» (native deps, ESM, undici, тощо) для reusable starter.

**Що потрібно змінити:**  
Єдине джерело правди (`.nvmrc`) для Dockerfile base image і CI.

**Точні зміни:**
1. `Dockerfile` — `node:22.22.1-bookworm-slim` (або sync `.nvmrc`↑24 свідомо).
2. Перевірити `npm ci && npm run build` на тому ж major.

---

### [Medium][Architectural risk] `AuthModule.forRootAsync` завжди підключає `JwtModule`, для session — з placeholder secret

**Доказ:**
- `libs/infrastructure/src/auth/auth.module.ts` `forRootAsync`: завжди `JwtModule.registerAsync`; для non-JWT → `{ secret: 'session-driver-jwt-placeholder' }`
- Sync `forRoot` правильно додає `JwtModule` лише для JWT
- Workspace rule: «Do not create both JWT and Session implementations when only one driver is selected»

**Що зараз не так:**  
Async path порушує driver isolation; hardcoded placeholder secret у session mode.

**Чому це проблема:**  
Portability/security hygiene: зайвий JWT wiring; якби `JwtService` випадково використали в session mode — підпис відомим placeholder.

**Dependency/runtime flow:**

```text
AuthApplicationCompositionModule
  -> AuthModule.forRootAsync
    -> JwtModule.registerAsync (always)
    -> TOKENS.AuthTokenService factory -> JwtAuthTokenService | SessionAuthTokenService
```

**Що потрібно змінити:**  
У `forRootAsync` реєструвати `JwtModule` лише коли `isJwtAuthOptions`; для session — не імпортувати Jwt і не інжектити `JwtService`.

**Точні зміни:**
1. `auth.module.ts` — conditional imports / split async provider graphs.
2. `auth.module.spec.ts` — assert no JwtModule providers under `AUTH_DRIVER=session`.
3. Оновити composition, якщо зміниться export shape.

**Приклад коду:**

```text
libs/infrastructure/src/auth/auth.module.ts
```

```ts
// Pseudocode target: build async dynamic module after resolving options,
// or use a dual-path factory module that imports JwtModule only for JWT driver.
```

---

### [Medium][Architectural risk] BullMQ не ізольований `REDIS_KEY_PREFIX` / немає queue prefix

**Доказ:**
- `RedisModule` / `RedisKeyBuilder` застосовують `REDIS_KEY_PREFIX`
- `InfrastructureBullMqModule.buildBullConnection` — host/port/db/password лише; без `prefix`
- `BullModule.registerQueue(...{ name })` — без prefix option
- Grep по `libs/infrastructure/src/bullmq` — немає `prefix` / `REDIS_KEY_PREFIX`

**Що зараз не так:**  
При shared Redis DB ключі BullMQ (`bull:*`) можуть колізити між проєктами; app prefix не захищає черги.

**Чому це проблема:**  
Starter позиціонується як copy-kit для багатьох проєктів; Redis isolation заявлена через prefix, але не покриває queues.

**Що потрібно змінити:**  
Додати configurable BullMQ `prefix` (з env + module options) у `forRoot`/`forRootAsync` і `.env.example`.

**Точні зміни:**
1. `bullmq.module-options.ts`, `create-starter-kit-module-options.ts`, `env.schema.ts`, `.env.example`
2. `bullmq.module.ts` — передати prefix у `BullModule.forRoot*`
3. Docs: infrastructure-modules README

---

### [Medium][Architectural risk] `envSchema` вимагає `JWT_SECRET` / `JWT_REFRESH_SECRET` навіть при `AUTH_DRIVER=session`

**Доказ:**
- `libs/infrastructure/src/config/env.schema.ts` — JWT fields завжди `z.string().min(1)`
- Production entropy checks також на JWT fields незалежно від driver (у `NODE_ENV=production`)

**Що зараз не так:**  
Session-only deployment змушений постачати JWT secrets.

**Чому це проблема:**  
Зайва surface area і friction для portable session-only composition.

**Що потрібно змінити:**  
`superRefine`: JWT required лише коли `AUTH_DRIVER=jwt` (і production entropy тільки тоді).

**Точні зміни:** `env.schema.ts` + config specs + `.env.example` comments.

---

### [Medium][Architectural risk] `DomainEventRouter` — all-or-nothing на multi-handler без checkpoint

**Доказ:**
- `libs/infrastructure/src/events/domain-event.router.ts` — sequential `await handler.handle`; throw → outbox `markFailed` / retry
- README вже фіксує at-least-once; handlers мають бути idempotent
- Сьогодні один handler (`UserRegisteredEventHandler`) — ризик латентний

**Що зараз не так:**  
При ≥2 handlers успішний перший side effect повториться після fail другого.

**Чому це проблема:**  
Starter event model масштабується poorly без per-handler progress або outbox-per-handler.

**Що потрібно змінити:**  
Документувати жорстке правило «один handler / ідемпотентність» або додати per-handler status; не подавати як exactly-once.

**Точні зміни:** README/MODULES + optional design ADR; код лише якщо розширюєте multi-handler гарантії.

---

### [Medium][Architectural risk] CI не ганяє build/lint/unit/module — лише release archive + gitleaks

**Доказ:**
- `.github/workflows/release-artifact.yml` — `npm ci` + `npm run release:check` + gitleaks
- Немає workflow на `npm run build` / `lint` / `test:unit` / `test:module`

**Що зараз не так:**  
Поточний `test:module` failure і майбутні DI регресії можуть не ловитись на PR.

**Чому це проблема:**  
Production-readiness starter kit без основного quality gate в CI.

**Що потрібно змінити:**  
Додати workflow: build + lint + test:unit + test:module (+ optional int з services).

**Точні зміни:** новий `.github/workflows/ci.yml` (або розширити існуючий).

---

### [Low][Confirmed defect] Відсутній `Idempotency-Key` мапиться на `ConflictError` → HTTP 409

**Доказ:**
- `idempotency.interceptor.ts` кидає `ConflictError('IDEMPOTENCY_KEY_REQUIRED', ...)`
- `GlobalExceptionFilter` → `ConflictError` = 409

**Що зараз не так:**  
Client validation / missing header — семантично 400, не conflict resource state.

**Чому це проблема:**  
Клієнти й OpenAPI споживачі неправильно класифікують помилку.

**Що потрібно змінити:** `ValidationError` / `InvalidAuthRequestError`-аналог → 400.

**Точні зміни:** interceptor + OpenAPI error docs + unit specs.

---

### [Low][Architectural risk] `LoggerModule.forRoot*` — `global: true`

**Доказ:** `libs/infrastructure/src/logger/logger.module.ts` — `global: true`

**Що зараз не так:**  
Прихована global dependency суперечить строгому «explicit imports only» для portable modules.

**Чому це проблема:**  
Складно побачити logger coupling при винесенні підмодуля.

**Що потрібно змінити:**  
Зробити non-global і явно імпортувати в composition roots (або задокументувати виняток).

---

### [Low][Architectural risk] `OutboxProcessorModule.forRoot` будує feature imports з порожніми `connectionImports`

**Доказ:** `outbox-processor.module.ts` `forRoot` → `buildFeatureImports([], handlers)` — Audit/Events без Drizzle/BullMQ imports; реальний Worker використовує `forRootAsync` з imports (OK)

**Що зараз не так:**  
Public sync API — footgun для інтегратора.

**Що потрібно змінити:**  
Вимагати imports у `forRoot` або deprecate sync API на користь async-only.

---

### Compact backlog (поза топ-списком)

- Int-spec open-handle leak (`test:int` force exit).
- `AuthGuard` кидає Nest `UnauthorizedException` замість domain `AuthenticationError` (різний error envelope vs AppError path).
- `docker-compose` `migrations` → `npm run db:migrate` без advisory lock (локально OK; не плутати з `db:migrate:prod`).
- Cache/Storage modules існують, але не підключені в жодному entrypoint (OK як optional; README «включає» може читатись як «уже wired»).

---

### 4. Невідповідності документації

### [Medium][Documentation mismatch] `EXAMPLES.md` вчить Nest DI всередині Application use cases

**Документація заявляє:**  
`GetUserByIdUseCase` з `@Injectable()` / `@Inject(TOKENS…)` з `@nestjs/common`; «Інжектіть через `@Inject`».

**Фактична реалізація:**  
`libs/application/src/use-cases/auth/*.ts` — plain classes; wiring лише в `AuthApplicationCompositionModule` factories. Grep: **нуль** `@nestjs` imports у `libs/application`. `AGENTS.md`: «plain TypeScript classes… Nest DI wiring belongs in composition roots only».

**Правильна цільова поведінка:**  
Приклади = actual pattern (constructor ports + composition `useFactory`).

**Потрібно змінити:** документацію (`EXAMPLES.md`); код уже правильний.

---

### [Medium][Documentation mismatch] `MODULES_OVERVIEW_NON_TECH.md` про outbox BullMQ `jobId` з outbox event id

**Документація заявляє:**  
«BullMQ job використовує стабільний jobId, побудований на основі outbox event id».

**Фактична реалізація:**  
`OutboxSchedule` ставить **один** job `jobId: 'outbox-process-pending'`. Per-event ids — у downstream email (`welcome-email:${event.id}`), не в outbox queue.

**Правильна цільова поведінка:**  
Описати two-stage flow: cron fixed jobId → DB claim/batch → handler enqueue з per-event jobId / idempotency.

**Потрібно змінити:** документацію (і за потреби README, якщо дублює).

---

### [Low][Documentation mismatch] Огляд модулів описує Cache/Storage як частину системи без факту wiring

**Документація заявляє:** Cache/Storage як наявні модулі системи (MODULES + README feature list).

**Фактична реалізація:** Модулі є (`CacheModule`, `StorageModule`), але **жоден** entrypoint їх не імпортує.

**Правильна цільова поведінка:** «Optional adapters; підключайте в composition root» + посилання на extraction guide.

**Потрібно змінити:** документацію (або demo wiring — окремий TASK).

---

### 5. Непідтверджені області

| Область | Статус | Причина |
|--------|--------|---------|
| API listen + HTTP auth/session/JWT E2E | Не підтверджено | Redis недоступний; `start:api` зупиняється на `assertRedisAvailable` |
| Worker processors (email/outbox) live | Не підтверджено | Немає Redis/Postgres; Docker down |
| Cron tick + distributed lock live | Не підтверджено | Немає Redis |
| `db:migrate:prod` advisory lock vs concurrent runners | Не підтверджено | Немає Postgres; destructive/prod migrate заборонені |
| SMTP/S3 real adapters | Не підтверджено | `MAIL_DRIVER=null` / storage не wired; зовнішні сервіси відсутні |
| `npm run test:all` / `test:release` | Не підтверджено | Не виконано повністю; `test:module` уже fail |
| Multi-instance outbox/cron races на живій БД | Не підтверджено | Int-specs skipped без Postgres |
| Production Docker image runtime | Не підтверджено | Image build/run не виконувався |
| Parent re-run of `npm run build` | Не підтверджено в parent | Auto-review block; build exit 0 взято з architecture-reviewer |

---

### 6. Підсумкова оцінка

## Підсумкова оцінка: 8.4/10

Оцінка базується на коді + підтверджених командах. Немає Critical/High → стеля 9.4 дозволена; 9.5+ недосяжна через незакриті Medium.

**Чому не 10/10:**
1. `test:module` червоний на `CronModule` (ioredis/BullMQ mock).
2. `test:int` green при повному skip інфри.
3. `AuthModule.forRootAsync` завжди тягне JwtModule (+ session placeholder).
4. Node major skew Dockerfile(24) vs `.nvmrc`/CI(22.22.1).
5. Документаційні розриви (EXAMPLES Nest-in-Application; outbox jobId narrative) + відсутній CI на build/lint/tests.

---

### 7. Що обов’язково зробити для 10/10

1. **Runtime і DI / verification gates**  
   - Fix `apps/cron/src/cron.module.spec.ts` ioredis mock → `npm run test:module` green.  
   - Fail-closed int-tests; додати CI: `build` + `lint` + `test:unit` + `test:module`.  
   - Bootstrap api/worker/cron проти Compose Postgres+Redis і зафіксувати evidence.

2. **Data integrity / Outbox / transactions**  
   - Залишити at-least-once явно; виправити MODULES jobId story.  
   - При multi-handler — ADR або per-handler idempotency/checkpoints.  
   - Прогнати `drizzle-outbox-processor.int-spec.ts` на реальній БД.

3. **Dependency direction**  
   - Вже сильна (Domain/Application без Nest/infra).  
   - Синхронізувати `EXAMPLES.md` з composition-root pattern.  
   - Розглянути non-global `LoggerModule`.

4. **Окремі composition roots**  
   - Зберегти мінімальні imports (Cron без Drizzle — добре).  
   - Вирівняти `AuthModule.forRootAsync` з sync driver isolation.  
   - JWT env лише для JWT driver.

5. **Portability / configuration**  
   - BullMQ `prefix` + env.  
   - `OutboxProcessorModule.forRoot` не приймати порожні connection imports.  
   - Dockerfile Node = `.nvmrc`.

6. **Production readiness**  
   - CI quality workflow.  
   - Compose vs `db:migrate:prod` чітко в ops docs.  
   - Закрити open-handle leaks у int tests.

7. **Документація**  
   - EXAMPLES, MODULES outbox jobId, Cache/Storage «optional until wired».  
   - Не заявляти SMS (модуля немає — OK, не вигадувати).
