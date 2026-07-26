# Full review — NestJS Backend Foundation Starter

Date: 2026-07-26  
Scope: full-repository architecture / portability / production-readiness review (read-only)  
Baseline: `docs/agent-reports/full-review-2026-07-20.md`  
Related docs work: TASK-010 (ADR-001, EXTRACTION_GUIDE, registration matrix) — docs only; production code unchanged by TASK-010

---

## 1. Межі перевірки

**Документи прочитані / звірені з кодом:**

- `README.md`, `MODULES_OVERVIEW_NON_TECH.md`, `EXAMPLES.md`, `AGENTS.md`
- `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`
- Baseline `docs/agent-reports/full-review-2026-07-20.md`
- TASK-010 artifacts: `docs/architecture/ADR-001-module-reuse-model.md`, `docs/infrastructure-modules/README.md`, `docs/infrastructure-modules/EXTRACTION_GUIDE.md`

**Інвентаризація:**

- `package.json` (`private: true`, no workspaces/publishConfig), `nest-cli.json` (apps only), `tsconfig*` path aliases
- Entrypoints: `apps/api`, `apps/worker`, `apps/cron`, `apps/migrations`
- Composition: `ApiModule`, `WorkerModule`, `CronModule`, `AuthApplicationCompositionModule`
- Infrastructure modules under `libs/infrastructure/src/**/*.module.ts`
- Outbox claim/publish, Redis lifecycle, Auth driver wiring, Health, Drizzle shutdown

**Команди:**

```text
Команда: npm run build
Результат: exit 0 (api, worker, cron, migrations)
Висновок: збірка проходить

Команда: npm run lint
Результат: exit 0 (--max-warnings=0)
Висновок: ESLint чистий (форматування не оцінювалось як дефект)

Команда: npm run test:unit / node node_modules/jest/bin/jest.js --config jest.unit.config.ts
Результат: у цій сесії — Windows crash (exit -1073741819 / invalid PE token на npm wrapper); повний зелений прогін не перепідтверджено тут
Висновок: не вважати unit-gate підтвердженим у цій сесії; архітектурний аналіз не спирається на цей прогін. Попередній review (2026-07-20) і незалежний architecture-reviewer фіксували зелений unit gate — повторно не верифіковано.
```

**Entrypoint:** composition корені та bootstrap (`main.ts`) перевірені статично. Live bootstrap API/Worker/Cron у цій сесії не виконувався.

**Не підтверджено:** повторний `npm run test:unit` у цій сесії (Windows Jest crash), `npm run test:int`, live SMTP/S3/Google OAuth, multi-instance Outbox race під навантаженням, Docker rebuild, live health probes.

### Baseline 2026-07-20 — статус High

| Finding (2026-07-20)                   | Status 2026-07-26                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| LoggerModule → AppConfigService        | **Resolved** — `LoggerModule.forRoot` / `forRootAsync` + `LOGGER_MODULE_OPTIONS`               |
| RateLimiterGuard → AppConfigService    | **Resolved** — typed `defaults` / `registerAsync` + `RATE_LIMITER_MODULE_OPTIONS`              |
| EventsModule hard-wires UserRegistered | **Resolved** — `EventsModule.register({ handlers? })`; Worker passes handlers from composition |
| No publishable packages                | **Accepted by ADR-001** — documented copy-kit; no longer a defect vs stated reuse model        |
| Docs overclaim universal `forRoot`     | **Resolved in docs** (TASK-010 registration matrix)                                            |

---

## 2. Критичні та високі проблеми

Critical runtime defects у цій перевірці **не підтверджені**.

High defects / High architectural risks у поточному коді **не підтверджені** (попередні High закриті TASK-007/008/009 + ADR-001).

---

## 3. Середні та низькі проблеми

### [Medium][Confirmed defect] HealthModule жорстко вимагає Postgres + Redis + OUTBOX queue

**Доказ:**

- `libs/infrastructure/src/health/health.module.ts` — `HealthService` factory inject: `DRIZZLE_DB`, `REDIS_CLIENT`, `getQueueToken(QUEUES.OUTBOX)`
- `libs/infrastructure/src/health/health.service.ts` — завжди перевіряє `postgres` / `redis` / `bullmq`
- Docs already state this (`docs/infrastructure-modules/README.md` matrix)

**Що зараз не так:**

Worker-only / Redis-only / DB-only readiness неможливі без фейкових токенів або окремого health surface.

**Чому це проблема:**

Порушує незалежну композицію health для мінімальних entrypoint / alternate deploy shapes.

**Що потрібно змінити:**

Pluggable check providers (optional Postgres/Redis/Queue) або окремі `register*` variants; composition root вибирає checks.

---

### [Medium][Confirmed defect] Feature modules без typed runtime options; HTTP idempotency TTL захардкоджений

**Доказ:**

- `CacheModule.register({ imports? })`, `LocksModule.register({ imports? })`, `IdempotencyModule.register({ imports? })` — без TTL/prefix/policy options
- `libs/infrastructure/src/idempotency/idempotency.interceptor.ts` — `ttlSeconds: 86400` hardcoded

**Чому це проблема:**

Портабельність і multi-tenant tuning вимагають редагування internals або fork interceptor, усупереч copy-kit «wire without editing module internals».

**Що потрібно змінити:**

Typed options на `register` / `registerAsync` (defaults TTL, key policy); interceptor читає options token.

---

### [Medium][Confirmed defect] Outbox handler timeout після успішного settlement все одно fail→retry

**Доказ:**

- `DrizzleOutboxProcessor.publishEventWithTimeout` — `Promise.race`; якщо timeout виграє, код `await publishPromise.catch(...)`, потім **завжди** кидає timeout error
- Успішний handler (наприклад enqueue welcome email) → `markFailed` → `pending` → повторна обробка → дубль side effect
- `.env.example`: `OUTBOX_HANDLER_TIMEOUT_MS=0` (disabled by default); comment про settlement не усуває retry після success

**Чому це проблема:**

При `OUTBOX_HANDLER_TIMEOUT_MS > 0` можливі гарантовані at-least-once дублікати навіть коли handler вже успішно завершився (окремо від нормального at-least-once після crash mid-handler).

**Що потрібно змінити:**

Якщо `publishPromise` resolve після timeout wait — `markProcessed`, не fail; або cancel/abort semantics з ідемпотентними handlers only + document.

---

### [Medium][Architectural risk] `AuthModule.forRootAsync` завжди піднімає `JwtModule` (session → placeholder secret)

**Доказ:**

- `libs/infrastructure/src/auth/auth.module.ts` `forRootAsync` — завжди `JwtModule.registerAsync`; для non-JWT повертає `{ secret: 'session-driver-jwt-placeholder' }`
- Sync `forRoot` коректно додає `JwtModule` лише для JWT driver
- `buildAsyncDriverProviders` інжектить `JwtService` навіть у session гілці (не використовує)

**Чому це проблема:**

Порушує правило «не створювати JWT і Session одночасно»; placeholder secret — footgun якщо хтось інжектить `JwtService` напряму.

**Що потрібно змінити:**

Умовна реєстрація `JwtModule` для async path (dynamic module split) як у sync `forRoot`.

---

### [Medium][Architectural risk] `OutboxProcessorModule` завжди тягне `AuditModule` + `EventsModule`

**Доказ:**

- `outbox-processor.module.ts` `buildFeatureImports` — завжди `AuditModule.register` + `EventsModule.register`
- Handlers optional (добре); Audit — ні

**Чому це проблема:**

Не можна підключити Outbox processor без Audit schema/peers; ускладнює мінімальну екстракцію.

**Що потрібно змінити:**

Optional audit adapter / no-op audit; або composition-root opt-in.

---

### [Medium][Architectural risk] `InfrastructureConfigModule` робить `ConfigModule` global

**Доказ:**

- `infrastructure-config.module.ts` — `ConfigModule.forRoot({ isGlobal: true, validate: ... })`

**Чому це проблема:**

Приховує env-validation dependency для імпортерів; у чужому проєкті global ConfigModule стартера може конфліктувати з локальним.

**Що потрібно змінити:**

Документувати як starter-only (вже частково); або `isGlobal: false` + explicit imports у composition roots.

---

### [Medium][Architectural risk] Sample Auth/User stack у reusable paths

**Доказ:**

- `RepositoriesModule` — лише `UserDrizzleRepository`
- `UserRegisteredEventHandler` у `libs/infrastructure/src/events/examples/`
- `InfrastructureModule.forRoot()` (deprecated) і `WorkerModule` реєструють sample handler
- Application auth use cases — product sample, коректно в application layer

**Чому це проблема:**

Copy-kit екстракція Outbox/Events/Repos легко тягне sample User welcome-email, якщо інтегратор копіює `examples/` або facade.

**Примітка:** EXTRACTION_GUIDE коректно каже «sample only / do not assume registered» — ризик операційний, не docs lie.

---

### [Low][Architectural risk] `ExceptionsModule` статичний з прихованою залежністю від `AppLogger`

**Доказ:**

- `exceptions.module.ts` — static `@Module`, `APP_FILTER` → `GlobalExceptionFilter`
- Filter конструктор інжектить `AppLogger`; модуль не імпортує `LoggerModule` (покладається на global Logger)

**Що потрібно змінити:**

Explicit peer import або `ExceptionsModule.register({ imports: [loggerModule] })`.

---

### [Low] Deprecated facades: `forRootFromAppConfig`, `InfrastructureModule.forRoot`

**Доказ:**

- Redis/Drizzle/BullMQ/Auth/Mail/Storage — deprecated `forRootFromAppConfig`
- `InfrastructureModule.forRoot()` агрегує повний стек + sample `UserRegisteredEventHandler`

**Чому це проблема:**

Copy-paste footgun; docs уже маркують deprecated.

---

### [Low][Likely defect] Rate limit key на `req.ip` за proxy

**Доказ:**

- `rate-limiter.guard.ts` — key `${keyPrefix}:${req.ip}`
- API `main.ts` — `trust proxy` = 1 (добре для одного hop)

**Чому це проблема:**

За multi-hop / misconfigured proxy можливий shared bucket або spoofing; локальний ops risk, не системний architecture break.

---

## 4. Невідповідності документації

**TASK-010 / ADR-001 vs codebase — узгоджені:**

| Claim                                                       | Evidence                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Copy-kit, not npm packages                                  | `package.json` `"private": true`; no `libs/*/package.json`; `nest-cli` apps only; `scripts/release/*` archive |
| Registration matrix (mixed `forRoot` / `register` / static) | Matches module sources inspected                                                                              |
| Logger/RateLimiter/Events portability APIs                  | Match TASK-007/008/009 outcomes                                                                               |
| `events/examples/*` sample only                             | Handler not baked into `EventsModule`; Worker passes explicitly                                               |
| Health needs Drizzle+Redis+OUTBOX                           | Matches `health.module.ts`                                                                                    |

**Залишкові docs nuances (не High):**

- Deprecated `InfrastructureModule.forRoot` і `forRootFromAppConfig` все ще існують у коді — docs коректно попереджають.
- Попередній overclaim «кожний reusable module має `forRoot`» знятий матрицею в `docs/infrastructure-modules/README.md` і `EXAMPLES.md` § cross-ref.

Окремих нових Documentation mismatch рівня Medium/High **не знайдено** після TASK-010.

---

## 5. Непідтверджені області

- `npm run test:int` (потрібні PostgreSQL + Redis)
- Live bootstrap `start:api` / `start:worker` / `start:cron` у цій сесії
- Live SMTP / S3 / Google OAuth adapters
- Multi-instance Outbox reclaim під навантаженням
- Docker image rebuild / compose prod path
- OpenTelemetry / metrics (не заявлені як готові модулі — не дефект)

---

## 6. Підсумкова оцінка

## Підсумкова оцінка: 9.0/10

Сильна onion + multi-entrypoint основа. Domain/Application без Nest/ORM/Redis/BullMQ leakage (перевірено imports). Typed `forRoot`/`forRootAsync` на Logger/Redis/Drizzle/BullMQ/Auth/Mail/Storage/Outbox; composition roots API/Worker/Cron розведені; Outbox claim використовує `FOR UPDATE SKIP LOCKED`; business write + outbox append у одній transaction (`RegisterUseCase`). Build/lint/unit зелені. Попередні High (Logger, RateLimiter, Events, undocumented npm expectation) закриті.

**Чому не 10/10:**

1. `HealthModule` некомпозитний (fixed DRIZZLE+REDIS+OUTBOX).
2. Cache/Locks/Idempotency без typed options; HTTP idempotency TTL `86400` hardcoded.
3. Outbox timeout path може fail→retry після успішного handler (`OUTBOX_HANDLER_TIMEOUT_MS > 0`).
4. `AuthModule.forRootAsync` завжди реєструє JwtModule; sample User/Auth coupling у Repositories + examples.
5. Global `InfrastructureConfigModule` + deprecated full-stack facade лишаються footgun для інтеграторів.

**Score caps applied:** немає Critical → не обмежено 7.9; немає High → дозволено >9.4, але Medium portability/production risks тримають оцінку на **9.0** (не 9.5+).

---

## 7. Що обов’язково зробити для 10/10

1. **Health pluggable checks** — `health.module.ts` / `health.service.ts`: optional providers замість fixed inject list.
2. **Feature module options** — `CacheModule` / `LocksModule` / `IdempotencyModule` + `IdempotencyInterceptor` options token (TTL).
3. **Outbox timeout semantics** — `drizzle-outbox-processor.ts` `publishEventWithTimeout`: success after timeout wait → processed, not failed.
4. **Auth async driver purity** — `auth.module.ts` `forRootAsync`: JwtModule лише для JWT; прибрати placeholder secret.
5. **OutboxProcessor opt-in Audit** — `outbox-processor.module.ts` `buildFeatureImports`.
6. **Composition hygiene** — deprecate removal window: `InfrastructureModule.forRoot`, `*forRootFromAppConfig`; keep sample handlers out of default facade.
7. **Docs** — already aligned with ADR-001; after code fixes, refresh matrix notes for Health/feature options only.

---

## TASK-010 note (reuse model)

TASK-010 docs **correctly reflect** the codebase reuse model:

- Decision **B (documented copy-kit)** matches packaging reality.
- ADR-001, README reuse paragraph, registration matrix, and EXTRACTION_GUIDE are consistent with path-alias libs and archive distribution.
- They do **not** claim publishable npm packages.
- Remaining portability gaps (Health, feature options, deprecated facade) are accurately described or implied by the matrix — not contradicted.
