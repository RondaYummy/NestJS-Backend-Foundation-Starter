# Full review — NestJS Backend Foundation Starter

**Date:** 2026-07-28  
**Branch:** `main`  
**Scope:** Full-repository architecture, DI, runtime and portability review  
**Reuse model:** documented copy-kit (ADR-001)

---

## 1. Межі перевірки

**Документи прочитані:**

- `README.md`
- `MODULES_OVERVIEW_NON_TECH.md`
- `EXAMPLES.md`
- `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`
- `AGENTS.md`
- `docs/architecture/ADR-001-module-reuse-model.md`
- `docs/infrastructure-modules/README.md`
- `docs/agent-backlog/INDEX.md` (порожній)

**Команди:**

| Команда               | Результат                                                       | Висновок                                                                          |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run build`       | pass (exit 0; перша спроба transient Windows `-4048`, retry OK) | Компіляція api/worker/cron/migrations зелена                                      |
| `npm run lint`        | pass (exit 0)                                                   | ESLint чистий                                                                     |
| `npm run test:unit`   | pass (38 suites / 216 tests)                                    | Unit gate зелений                                                                 |
| `npm run test:module` | fail (1 suite: `CronModule`)                                    | Див. знахідку про incomplete ioredis mock / BullMQ close; Redis контейнерів немає |
| `npm run test:int`    | skipped                                                         | Docker без запущених контейнерів — PostgreSQL/Redis недоступні                    |

**Entrypoints перевірені статично:** `apps/api`, `apps/worker`, `apps/cron`, `apps/migrations`. Live bootstrap HTTP/Worker/Cron **не підтверджено** (немає інфри).

**Середовище:** Node `v22.22.1`, npm `10.9.4`.

---

## 2. Критичні та високі проблеми

Critical runtime/data defects, що ламають систему за замовчуванням, **не підтверджені**. Нижче — High confirmed / likely issues.

### [High][Confirmed defect] Session user-index TTL перезаписується TTL нової сесії

**Доказ:**

- `libs/infrastructure/src/auth/redis-session-store.service.ts` — `RedisSessionStore.create`
- після `sadd` завжди викликається `expire(userIndexKey, ttlSeconds)` з TTL **поточної** сесії

```16:23:libs/infrastructure/src/auth/redis-session-store.service.ts
  async create(record: SessionRecord, ttlSeconds: number): Promise<string> {
    const sessionId = randomUUID();
    const sessionKey = this.sessionKey(sessionId);
    const userIndexKey = this.userIndexKey(record.userId);

    await this.redisService.set(sessionKey, JSON.stringify(record), ttlSeconds);
    await this.redisService.sadd(userIndexKey, sessionId);
    await this.redisService.expire(userIndexKey, ttlSeconds);
```

**Що зараз не так:**

Індекс користувача може закінчитися раніше за довгоживучі session keys. `listByUserId` / `revokeAll` / `revokeOthers` бачать неповний набір; cookie-auth через `get(sessionId)` лишається валідним.

**Чому це проблема:**

Session management API стає неконсистентним; «revoke all devices» не гарантований. Для portable starter store API небезпечний навіть якщо зараз caller передає фіксований TTL.

**Що потрібно змінити:**

1. Не ставити `EXPIRE` індексу сліпо на TTL останньої сесії.
2. Варіанти: ZSET зі score=expiry; `EXPIRE` = max(currentTtl, newTtl); prune-on-read без TTL індексу.
3. Додати unit-тест на дві сесії з різними TTL.

---

### [High][Confirmed defect] Change/reset password не чистить Redis sessions і JWT refresh families

**Доказ:**

- `libs/application/src/use-cases/auth/change-password.usecase.ts` — bump `authVersion` + `createAuthSession`, без `revokeAll` / family revoke
- `libs/application/src/use-cases/auth/reset-password.usecase.ts` — аналогічно
- верифікація покладається на `authVersion` (`SessionAuthTokenService` / `JwtAuthTokenService` + `resolveAccessUser` у composition)

**Що зараз не так:**

Старі session records і refresh keys лишаються в Redis до TTL. `GET /v1/sessions` може показувати «мертві» пристрої. `revokeAll` не дістає index-сиріт (посилює попередню знахідку). Споживачі `AuthModule` без `resolveAccessUser` приймають старі access JWT до expiry.

**Чому це проблема:**

Неповна security hygiene після зміни пароля; session UX і portable defaults вводять в оману.

**Що потрібно змінити:**

1. Після успішного change/reset: session driver → `ISessionManagementService.revokeAll`; JWT → revoke усіх refresh families користувача (потрібен порт/індекс).
2. Фільтрувати list за `authVersion` або видаляти stale eagerly.
3. Документувати обов’язковість `resolveAccessUser` / `resolveSessionUser` для freshness.

---

### [High][Confirmed defect] Idempotency: side effects можуть виконатися без збереженого результату

**Доказ:**

- `libs/infrastructure/src/idempotency/idempotency.service.ts` — `RedisIdempotencyService.execute` (рядки ~83–111)
- `handler()` виконується **до** `completeIdempotency`; при `lockLost` / failed complete кидається `IDEMPOTENCY_LOCK_LOST`, результат не кешується

**Що зараз не так:**

Повтор з тим самим ключем може повторно виконати handler після успішного першого side effect.

**Чому це проблема:**

Starter рекламує idempotency для POST/PUT/PATCH (`EXAMPLES.md`). Патерн unsafe для грошових / мутуючих операцій під expiry lock або Redis blip.

**Що потрібно змінити:**

1. Розширити lock TTL під SLA handler + heartbeat (вже є частково).
2. На lock-lost після успіху: best-effort write результату або conflict без «сліпого» retry.
3. Документувати at-least-once / client retry semantics явно.

---

### [Medium→High][Likely defect] `revokeRefreshTokenFamily` неатомарний

**Доказ:**

- `libs/infrastructure/src/auth/redis-jwt-token-store.service.ts` — `revokeRefreshTokenFamily` (GET → DEL token → DEL family)
- контраст: `rotateRefreshToken` / `saveRefreshToken` — Lua

**Що зараз не так:**

Concurrent rotate + logout/reuse-revoke може залишити orphan token key або втратити family cursor.

**Що потрібно змінити:**

Єдиний Lua-скрипт: read family → delete token + family (+ optional revoked marker).

---

## 3. Середні та низькі проблеми

### [Medium][Architectural risk] `DrizzleTransactionManager` завжди відкриває root transaction

**Доказ:** `libs/infrastructure/src/transactions/drizzle-transaction.manager.ts` — немає ALS/savepoint nesting.

Nested `run()` з композитних use cases = друга connection, хибна атомарність. Зараз callers однорівневі (`register`, Google sign-in).

**Що потрібно:** AsyncLocalStorage context + savepoints або заборона nested `run`.

---

### [Medium][Likely defect] Outbox handler timeout → можливий duplicate publish

**Доказ:** `libs/infrastructure/src/outbox/drizzle-outbox-processor.ts` — `publishEventWithTimeout`; default `handlerTimeoutMs: 0` (вимкнено).

При увімкненому timeout slow-but-successful publish може бути markFailed → pending → повтор.

**Що потрібно:** Не markFailed без доказу, що publish не завершився; abort signal; handlers idempotent (вже очікується).

---

### [Medium][Confirmed defect] `CronModule` module-spec падає на `close` через incomplete Redis mock

**Доказ:** `apps/cron/src/cron.module.spec.ts` мокає `ioredis` мінімально; BullMQ `RedisConnection.close` очікує `.off` → `TypeError`. `npm run test:module` — 1 failed suite (Redis контейнерів немає).

**Що потрібно:** Повніший mock Redis / BullMQ connection lifecycle у module specs; або не викликати `moduleRef.close()` без stubbed queue shutdown.

---

### [Medium][Architectural risk] Session-driver реєструє JwtModule з hardcoded placeholder secret

**Доказ:** `libs/infrastructure/src/auth/auth.module.ts` — `'session-driver-jwt-placeholder'` коли driver ≠ jwt.

Нешкідливо, якщо `JwtService` не використовується; небезпечно при пізнішому inject `JwtService`.

**Що потрібно:** Не реєструвати `JwtModule` для session driver.

---

### [Low][Confirmed] Logout без rate limit

**Доказ:** `apps/api/src/controllers/auth.controller.ts` — login/refresh/forgot/reset мають `RateLimiterGuard`; logout — ні.

---

### [Low][Architectural risk] Security hardening gaps (не defects runtime)

- немає Helmet / HSTS / CSP middleware у `apps/api/src/main.ts`;
- `StorageModule` / `CacheModule` не підключені до жодного entrypoint (extractable, але не продемонстровані);
- RBAC scaffolding (`RolesGuard`, `@Public`, `@Roles`) не використані на controllers;
- немає `@Idempotent()` на auth mutations (opt-in interceptor існує).

---

## 4. Невідповідності документації

### [Medium][Documentation mismatch] EXAMPLES.md тягне Nest у Application

**Документація заявляє:** `@Injectable()` + `@Inject(TOKENS…)` на use case у `EXAMPLES.md`.

**Фактична реалізація:** plain classes + `useFactory` у `AuthApplicationCompositionModule` (`AGENTS.md`).

**Потрібно змінити:** документацію (EXAMPLES) під composition-root pattern.

---

### [Low][Documentation mismatch] Queue matrix API без EMAIL

**Документація заявляє:** API queues = `OUTBOX` only (`docs/infrastructure-modules/README.md`).

**Фактична реалізація:** `ApiModule` реєструє `[QUEUES.OUTBOX, QUEUES.EMAIL]` (forgot-password enqueue).

**Потрібно змінити:** документацію (або прибрати EMAIL з API, якщо enqueue має йти інакше — зараз код правильніший за docs).

---

## 5. Непідтверджені області

- Live bootstrap `start:api` / `start:worker` / `start:cron` з реальною інфрою.
- `npm run test:int` (PostgreSQL + Redis).
- Multi-instance outbox claim під навантаженням.
- Google OAuth end-to-end з реальним IdP.
- SMTP / S3 adapter runtime.
- Docker Compose full stack startup.
- Production cookie `SameSite=None` + HTTPS path.

Outbox claim (`FOR UPDATE SKIP LOCKED`), transactional append, migration advisory lock, Google state one-time consume, rate limiter fail-closed — перевірені **статично** і виглядають коректно.

---

## 6. Підсумкова оцінка

## Підсумкова оцінка: 8.2/10

Сильна copy-kit основа: onion межі чисті, чотири незалежні entrypoints, dual auth + Google SSO, transactional Outbox + SKIP LOCKED, typed dynamic modules, env hardening для JWT secrets у production, зелені build/lint/unit.

**Чому не 10/10:**

1. Session user-index TTL семантика ламає list/revoke completeness.
2. Password change/reset не purge Redis session/JWT family state.
3. Idempotency може виконати side effect без збереженого результату.
4. JWT family revoke неатомарний; nested transactions — footgun.
5. Docs drift (EXAMPLES Nest-in-application; API EMAIL queue) + module-test fragility без Redis.

Немає підтвердженої Critical, що валить default runtime → оцінка вище 7.9. Є High confirmed → оцінка не вище 9.4.

---

## 7. Що обов’язково зробити для 10/10

1. **Runtime / auth data integrity**
   - Виправити `RedisSessionStore.create` index TTL (`redis-session-store.service.ts`).
   - Після change/reset password — revoke sessions + JWT families (`change-password.usecase.ts`, `reset-password.usecase.ts` + management ports).
   - Atomic Lua для `revokeRefreshTokenFamily`.

2. **Idempotency**
   - Harden `RedisIdempotencyService.execute` completion vs side effects; документувати retry semantics.

3. **Transactions / Outbox**
   - Nested-safe `DrizzleTransactionManager` (ALS/savepoints).
   - Timeout ownership policy у `drizzle-outbox-processor.ts` коли `handlerTimeoutMs > 0`.

4. **Composition / DI portability**
   - Не реєструвати JwtModule з placeholder під session driver (`auth.module.ts`).
   - Починити `cron.module.spec.ts` Redis/BullMQ lifecycle mock.

5. **Production readiness (enhancements → 10/10)**
   - Helmet (або еквівалент), явні security headers.
   - Rate-limit logout; розглянути global abuse policy.
   - HTTP/e2e тести критичних auth cookie + guard шляхів.
   - Підключити демо `CacheModule` / `StorageModule` або явно позначити як optional extracts.
   - Observability: OpenTelemetry / metrics / structured correlation вже частково є — стандартизувати tracing export.

6. **Документація**
   - Переписати `EXAMPLES.md` під plain use cases + composition factories.
   - Виправити queue matrix у `docs/infrastructure-modules/README.md` (API + EMAIL).

---

## 8. Compact backlog — що ще варто додати для portable starter

Не defects, а gaps для «фундаменту під різні проєкти»:

| Пріоритет | Ідея                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| P1        | RBAC приклад на реальному endpoint (`RolesGuard` end-to-end)                   |
| P1        | Feature-flag / optional module recipes (Auth JWT-only vs Session-only extract) |
| P2        | OpenTelemetry + Prometheus health/metrics patterns                             |
| P2        | Multi-tenant / key-prefix isolation cookbook                                   |
| P2        | Webhooks + signature verification module                                       |
| P2        | Soft-delete / audit query helpers beyond write-only audit                      |
| P3        | Publishable packages (ADR-001 model A) — окремий великий трек                  |
| P3        | SMS / push notification ports дзеркально до Mail                               |
| P3        | CQRS read-model / projection sample                                            |
| P3        | Graceful drain runbooks для Worker/Cron у k8s                                  |

---

## Classification summary

| #   | Severity    | Class         | Title                                    |
| --- | ----------- | ------------- | ---------------------------------------- |
| 1   | High        | Confirmed     | Session user-index TTL overwrite         |
| 2   | High        | Confirmed     | Password change/reset без Redis purge    |
| 3   | High        | Confirmed     | Idempotency lock-lost після side effects |
| 4   | Medium-High | Likely        | Non-atomic JWT family revoke             |
| 5   | Medium      | Architectural | Nested transaction footgun               |
| 6   | Medium      | Likely        | Outbox timeout duplicates                |
| 7   | Medium      | Confirmed     | CronModule module-spec Redis mock        |
| 8   | Medium      | Docs          | EXAMPLES Nest-in-application             |
| 9   | Medium      | Architectural | Session-driver JWT placeholder           |
| 10  | Low         | Confirmed     | Logout без rate limit                    |
| 11  | Low         | Docs          | API queue matrix missing EMAIL           |
