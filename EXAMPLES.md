# Приклади типових завдань

Короткий практичний гайд для щоденної роботи зі starter-kit. Детальна архітектура — у [README.md](./README.md).

## Зміст

1. [Додати новий HTTP endpoint](#1-додати-новий-http-endpoint)
2. [Додати use case без нового endpoint](#2-додати-use-case-без-нового-endpoint)
3. [Розширити repository та БД](#3-розширити-repository-та-бд)
4. [Транзакція в use case](#4-транзакція-в-use-case)
5. [Захистити endpoint](#5-захистити-endpoint)
6. [Rate limit на endpoint](#6-rate-limit-на-endpoint)
7. [Idempotency для POST/PUT/PATCH](#7-idempotency-для-postputpatch)
8. [Додати змінну оточення](#8-додати-змінну-оточення)
9. [Email — React Email шаблони](#9-email--react-email-шаблони)
10. [Додати BullMQ job (worker)](#10-додати-bullmq-job-worker)
11. [Додати cron-задачу](#11-додати-cron-задачу)
12. [Корисні команди](#12-корисні-команди)
13. [Підключити infrastructure module окремо](#13-підключити-infrastructure-module-окремо)

---

## 1. Додати новий HTTP endpoint

Приклад: `GET /users/:id` — отримати профіль користувача за id.

### Крок 1. Domain (якщо потрібна нова логіка)

Зазвичай достатньо існуючої сутності `User`. Для нових правил — `libs/domain/src/`.

### Крок 2. Contract (якщо потрібен новий порт)

Якщо вистачає `IUserRepository.findById` — пропустіть. Інакше додайте інтерфейс у `libs/contracts/src/` і символ у `libs/contracts/src/tokens.ts`.

### Крок 3. Use case

`libs/application/src/use-cases/users/get-user-by-id.usecase.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { IUserRepository } from '@contracts/repositories/user.repository';
import { TOKENS } from '@contracts/tokens';
import { NotFoundError } from '@domain/errors/domain-errors';

@Injectable()
export class GetUserByIdUseCase {
  constructor(
    @Inject(TOKENS.UserRepository)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'User not found', { userId });
    }
    return {
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
    };
  }
}
```

Зареєструйте use case в composition-модулі того entrypoint,
який його використовує.

Для API, наприклад:

`apps/api/src/composition/users-application.module.ts`

```ts
import { Module } from '@nestjs/common';

import { RepositoriesModule } from '@infrastructure/repositories/repositories.module';

import { GetUserByIdUseCase } from '@application/use-cases/users/get-user-by-id.usecase';

@Module({
  imports: [RepositoriesModule],
  providers: [GetUserByIdUseCase],
  exports: [GetUserByIdUseCase],
})
export class UsersApplicationCompositionModule {}
```

### Крок 4. DTO (API-шар)

`apps/api/src/dto/users/get-user-params.dto.ts` — за потреби (для `:id` часто достатньо `@Param('id')`).

### Крок 5. Controller

`apps/api/src/controllers/users.controller.ts`:

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { GetUserByIdUseCase } from '@application/use-cases/users/get-user-by-id.usecase';
import { AuthGuard } from '../guards/auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly getUserByIdUseCase: GetUserByIdUseCase) {}

  @UseGuards(AuthGuard)
  @Get(':id')
  async getById(@Param('id') id: string) {
    const data = await this.getUserByIdUseCase.execute(id);
    return { success: true, data };
  }
}
```

### Крок 6. Підключити в API module

`apps/api/src/api.module.ts`:

```ts
import { UsersController } from './controllers/users.controller';

@Module({
  controllers: [AuthController, UsersController],
  // ...
})
```

### Крок 7. Оновити canonical OpenAPI contract

У DTO додайте typed `@ApiProperty` / `@ApiPropertyOptional`, а в controller — operation, request, success/error responses, auth, headers і cookies. Згенерований контракт має точно відображати validation та фактичні response bodies.

Перевірте endpoint у Swagger UI: `http://localhost:3000/v1/docs`, а машинозчитуваний документ — у `http://localhost:3000/v1/docs-json`. `API_DOCS_ENABLED` за замовчуванням увімкнений у development/test і вимкнений у production.

Оновіть `apps/api/src/openapi/openapi-contract.spec.ts`, щоб drift check охоплював новий method/path і ключові request/response schemas.

### Крок 8. Перевірка

```bash
npm run start:dev:api
# GET http://localhost:3000/v1/users/<uuid>  + Authorization: Bearer <token>
```

**Правило:** controller → use case → contract (repository). Controller **не** імпортує Drizzle, Redis, `@domain` напряму. HTTP endpoint не завершений без синхронізованого OpenAPI contract.

---

## 2. Додати use case без нового endpoint

1. Створіть файл у `libs/application/src/use-cases/<feature>/`.
2. Інжектіть залежності через `@Inject(TOKENS.…)`.
3. Додайте клас у `Module` (`providers` + `exports`).
4. Використайте в controller, worker processor або cron schedule.

---

## 3. Розширити repository та БД

### Нова колонка / таблиця

1. Оновіть схему: `libs/infrastructure/src/database/drizzle/schema/`.
2. Експортуйте з `libs/infrastructure/src/database/drizzle/schema/index.ts`.
3. Згенеруйте міграцію:

```bash
npm run db:generate
npm run db:migrate
```

4. Оновіть mapper: `libs/infrastructure/src/mappers/`.
5. Додайте методи в `libs/contracts/src/repositories/…` і реалізацію в `libs/infrastructure/src/repositories/…`.

### Новий repository

1. Інтерфейс у `libs/contracts/src/repositories/`.
2. `TOKENS` у `libs/contracts/src/tokens.ts`.
3. Drizzle-реалізація + mapper.
4. Реєстрація в `libs/infrastructure/src/repositories/repositories.module.ts`:

```ts
{ provide: TOKENS.MyRepository, useExisting: MyDrizzleRepository },
```

---

## 4. Транзакція в use case

Кілька операцій з БД в одній транзакції (приклад — реєстрація):

```ts
async execute(input: RegisterInput) {
  const passwordHash = await this.passwordHasher.hash(input.password);
  const email = Email.create(input.email);

  const user = await this.transactionManager.run(async (trx) => {
    const newUser = User.create({
      email: email.toString(),
      passwordHash,
      roles: ['user'],
    });

    await this.userRepository.insert(newUser, trx);

    await this.outboxWriter.append(
      new UserRegisteredEvent({
        userId: newUser.id,
        email: newUser.email.toString(),
      }),
      trx,
    );

    return newUser;
  });

  // Повертає лише user — auth/session створюється окремим POST /v1/auth/login
  return {
    user: {
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
    },
  };
}
```

Зовнішні сервіси (Redis auth state, email, queue) **не** тримайте всередині `transactionManager.run()`. Welcome email enqueue-иться асинхронно через Outbox → Worker, а не в цьому use case.

### 4.1. Register then login

`POST /v1/auth/register` створює обліковий запис і повертає лише `user`. Для отримання auth tokens або session cookie викличте `POST /v1/auth/login` окремим запитом (однаковий контракт для JWT і session driver).

**Register:**

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "new@example.com",
    "password": "StrongPassword123!"
  }'
```

Приклад відповіді:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "<user-id>",
      "email": "new@example.com",
      "roles": ["user"]
    }
  }
}
```

Поле `data.auth` **відсутнє** — це очікувана поведінка.

**Login (JWT driver, `AUTH_DRIVER=jwt`):**

```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "new@example.com",
    "password": "StrongPassword123!"
  }'
```

Приклад відповіді — див. [§5.1 Login](#51-jwt-login-refresh-і-logout) (`data.user` + `data.auth.accessToken` / `data.auth.refreshToken`).

**Login (session driver, `AUTH_DRIVER=session`):**

Той самий `POST /v1/auth/login`; сервер встановлює cookie `sid` (див. `README.md` §16). У тілі відповіді також є `data.auth` з session metadata; клієнт використовує cookie для наступних запитів.

---

## 5. Захистити endpoint

Публічний маршрут — без guard. Потрібна авторизація:

```ts
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { RequestUser } from '../types/request-user.type';

@UseGuards(AuthGuard)
@Get('me')
async me(@CurrentUser() user: RequestUser) {
  // user.id, user.email, user.roles
}
```

Клієнт передає `Authorization: Bearer <access_token>` або cookie `sid` (режим session).

---

## 5.1. JWT login, refresh і logout

### Login

```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "StrongPassword123!"
  }'
```

Приклад відповіді:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "<user-id>",
      "email": "user@example.com",
      "roles": ["user"]
    },
    "auth": {
      "accessToken": "<access-token>",
      "refreshToken": "<refresh-token>"
    }
  }
}
```

### Поточний користувач

```bash
curl http://localhost:3000/v1/auth/me \
  -H "Authorization: Bearer <access-token>"
```

### Refresh

```bash
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<current-refresh-token>"
  }'
```

Після успішного refresh сервер повертає нову пару:

```json
{
  "success": true,
  "data": {
    "accessToken": "<new-access-token>",
    "refreshToken": "<new-refresh-token>"
  }
}
```

Потрібно замінити обидва старі токени. Старий refresh token більше не використовується.

### Logout

```bash
curl -X POST http://localhost:3000/v1/auth/logout \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<current-refresh-token>"
  }'
```

Після logout:

- refresh-token family відкликана;
- переданий access token доданий у blacklist;
- старий access token повертає `401`;
- старий refresh token повертає `401`.

### Logout без access token

Якщо access token уже протермінований:

```bash
curl -X POST http://localhost:3000/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<current-refresh-token>"
  }'
```

Refresh-token family все одно буде відкликана.

## 5.1a. Session management (`AUTH_DRIVER=session`)

Endpoints під `/v1/sessions` доступні **лише** коли `AUTH_DRIVER=session`. Під `AUTH_DRIVER=jwt` ті самі маршрути зареєстровані, але повертають `400` з `error.code = SESSION_DRIVER_REQUIRED`. Потрібна httpOnly session cookie (`sid` за замовчуванням).

### List sessions

```bash
curl http://localhost:3000/v1/sessions \
  -b "sid=<session-id>"
```

Приклад відповіді:

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "<session-id>",
        "createdAt": "2026-07-19T09:00:00.000Z",
        "lastActivityAt": "2026-07-19T09:00:00.000Z",
        "expiresAt": "2026-07-26T09:00:00.000Z",
        "ip": "203.0.113.10",
        "userAgent": "Mozilla/5.0 ...",
        "isCurrent": true
      }
    ]
  }
}
```

### Revoke one session

```bash
curl -X DELETE http://localhost:3000/v1/sessions/<session-id> \
  -b "sid=<current-session-id>"
```

Якщо `<session-id>` збігається з cookie — Redis-сесія видаляється і cookie очищується (`Set-Cookie` Max-Age=0).

### Revoke all other sessions

```bash
curl -X DELETE http://localhost:3000/v1/sessions/others \
  -b "sid=<current-session-id>"
```

Відповідь: `{ "success": true, "data": { "revokedCount": 2 } }`. Поточна сесія лишається дійсною.

### Revoke all sessions (sign out everywhere)

```bash
curl -X DELETE http://localhost:3000/v1/sessions \
  -b "sid=<current-session-id>"
```

Усі сесії користувача видаляються; cookie очищується.

## 5.2. Зміна та відновлення пароля

### Change password (авторизований користувач)

```bash
curl -X POST http://localhost:3000/v1/auth/change-password \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "OldPassword123!",
    "newPassword": "NewStrongPassword123!"
  }'
```

Успіх — `200` з login-подібною відповіддю (`data.user` + `data.auth`): `authVersion` збільшується, усі попередні JWT/session креденшли стають недійсними, а клієнт одразу отримує свіжі. У режимі `AUTH_DRIVER=session` сервер також встановлює новий cookie `sid`.

Помилки: `400 INVALID_CURRENT_PASSWORD` (невірний поточний пароль), `400 SAME_PASSWORD` (новий пароль збігається з поточним), `401` без авторизації.

### Forgot password (запит на reset)

```bash
curl -X POST http://localhost:3000/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

Відповідь завжди `200 { "success": true }` — незалежно від того, чи існує акаунт (захист від enumeration). Якщо акаунт існує, у Redis зберігається **hash** одноразового токена (TTL за `PASSWORD_RESET_TOKEN_TTL_SECONDS`, за замовчуванням 30 хвилин), а лист із токеном ставиться в чергу `QUEUES.EMAIL`.

Доставка листа вимагає:

- запущеного **Worker** (він обробляє чергу email);
- `MAIL_DRIVER=smtp` + `SMTP_*` для реальної відправки (`null` — лист не відправляється);
- опційно `PASSWORD_RESET_URL_BASE` — тоді лист містить посилання `${PASSWORD_RESET_URL_BASE}?token=<token>` разом із самим токеном.

### Reset password (підтвердження токеном)

```bash
curl -X POST http://localhost:3000/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<token-з-листа>",
    "newPassword": "NewStrongPassword123!"
  }'
```

Успіх — `200` з login-подібною відповіддю та свіжими auth-артефактами (як change-password). Токен одноразовий: повторне використання, протермінований або невідомий токен повертає `400 INVALID_RESET_TOKEN` без зміни пароля.

## 5.3. Google SSO (опційний модуль)

За замовчуванням вимкнено: `GET /v1/auth/google` і `GET /v1/auth/google/callback` зареєстровані, але повертають `503 GOOGLE_SSO_DISABLED` без звернень до Google.

Увімкнення:

```env
GOOGLE_SSO_ENABLED=true
GOOGLE_CLIENT_ID=<client-id з Google Cloud console>
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/v1/auth/google/callback
```

У Google Cloud console зареєструйте той самий redirect URI (`{origin}/v1/auth/google/callback`; поза локальною розробкою — тільки HTTPS). Якщо будь-яка з обов'язкових змінних порожня при `GOOGLE_SSO_ENABLED=true`, конфігурація падає на старті (fail-fast, як SMTP/S3).

Flow (authorization-code redirect):

```bash
# 1. Браузер відкриває start endpoint (опційно з returnUrl, origin якого є в CORS_ORIGINS):
#    GET http://localhost:3000/v1/auth/google?returnUrl=http://localhost:3000/auth/complete
#    → 302 на accounts.google.com + httpOnly cookie g_oauth_state (одноразовий CSRF state)

# 2. Після згоди Google повертає браузер на callback:
#    GET http://localhost:3000/v1/auth/google/callback?code=...&state=...
```

Результат callback — ті самі auth-артефакти, що й `POST /v1/auth/login`:

- `AUTH_DRIVER=jwt` — `200` JSON `{ success, data: { user, auth: { accessToken, refreshToken } } }`. `returnUrl` для доставки успіху ігнорується: JWT ніколи не потрапляє в URL (для браузерних SPA використовуйте BFF, який споживає JSON callback, або session driver).
- `AUTH_DRIVER=session` — встановлюється httpOnly cookie `sid`; якщо flow стартував з allowlisted `returnUrl`, відповідь — `302` на нього, інакше `200` JSON.

Ідентичність: спершу пошук за Google `sub`; далі auto-link за email (тільки якщо Google підтверджує email як verified); інакше створюється новий користувач без локального пароля (`password_hash = NULL`) з подією `UserRegisteredEvent` через Outbox.

Для Google-only акаунтів: `POST /v1/auth/login` повертає `400 INVALID_CREDENTIALS`, `change-password` — `400 PASSWORD_NOT_SET`; встановити перший локальний пароль можна через `forgot-password` → `reset-password`.

Коди помилок: `GOOGLE_SSO_DISABLED` (503), `INVALID_RETURN_URL` (400), `GOOGLE_SSO_INVALID_STATE` (400), `GOOGLE_SSO_TOKEN_EXCHANGE_FAILED` (401), `GOOGLE_SSO_EMAIL_UNVERIFIED` (401), `GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH` (401, лише з `GOOGLE_SSO_HOSTED_DOMAIN`).

## 6. Rate limit на endpoint

```ts
import { UseGuards } from '@nestjs/common';
import { RateLimiterGuard } from '@infrastructure/rate-limiter/rate-limiter.guard';
import { RateLimit } from '@infrastructure/rate-limiter/rate-limit.decorator';

@UseGuards(RateLimiterGuard)
@RateLimit({ keyPrefix: 'auth:login' }) // для auth:* — ліміти з RATE_LIMIT_AUTH_*
@Post('login')
async login() { /* ... */ }

// Жорсткіший ліміт на конкретний route:
@RateLimit({ keyPrefix: 'api:heavy', limit: 10, ttlSeconds: 60 })
```

У `.env`:

```env
RATE_LIMIT_AUTH_TTL=60
RATE_LIMIT_AUTH_MAX=5
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100
```

Потрібен запущений **Redis**.

---

## 7. Idempotency для POST/PUT/PATCH

`IdempotencyInterceptor` зареєстрований глобально в `ApiModule`, але idempotency **opt-in**: interceptor перевіряє metadata і застосовується лише до endpoint-ів з `@Idempotent()`. Без decorator запит проходить без перевірки `Idempotency-Key`.

### Увімкнути для endpoint-а

```ts
import { Idempotent } from '@infrastructure/idempotency/idempotent.decorator';

@Idempotent()
@Post('orders')
async createOrder() { /* ... */ }
```

Клієнт мутації має передати заголовок:

```http
POST /orders
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "productId": "product-id",
  "quantity": 1
}
```

Без `Idempotency-Key` endpoint з `@Idempotent()` поверне `409`.

Повторний запит з тим самим ключем і тим самим payload поверне збережене тіло відповіді.

### Коли не використовувати `@Idempotent()`

`@Idempotent()` не слід застосовувати до endpoint-ів, які:

- встановлюють або очищують cookies;
- повертають файли або stream;
- використовують dynamic response headers;
- можуть повертати різні успішні HTTP status codes.

Тому decorator не використовується на:
POST /v1/auth/register
POST /v1/auth/login
POST /v1/auth/logout
POST /v1/auth/refresh

---

## 8. Додати змінну оточення

1. `libs/infrastructure/src/config/env.schema.ts` — Zod-поле.
2. `libs/infrastructure/src/config/infrastructure-config.module.ts` — мапінг у nested config.
3. `libs/infrastructure/src/config/app-config.service.ts` — тип у `ConfigShape`.
4. `.env.example` — документація для команди.
5. Використання: `config.app('section.key')` у **infrastructure**, не в domain/application.

---

## 9. Email — React Email шаблони

### Потік

```txt
use-case → QUEUES.EMAIL (template + data) → EmailProcessor → MailTemplateService → SMTP
```

### Відправити welcome після реєстрації

```ts
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';

await this.domainEventRouter.route({
  id: event.id,
  name: event.name,
  payload: event.payload,
  occurredAt: event.occurredAt.toISOString(),
});
```

### Додати новий шаблон

1. `libs/contracts/src/mail/email-template-id.ts` — константа, напр. `PASSWORD_RESET: 'password-reset'`.
2. `libs/contracts/src/mail/email-template-data.ts` — тип даних.
3. `libs/infrastructure/src/mail/templates/password-reset.email.tsx` — React-компонент.
4. `libs/infrastructure/src/mail/mail-template.registry.tsx` — `case` у `switch`.
5. Use case — `template` + `data` у job.

Наявні шаблони: `welcome` (welcome email після реєстрації) та `password-reset` (лист відновлення пароля, див. §5.2). Живий приклад структури листа — `libs/infrastructure/src/mail/templates/password-reset.email.tsx`:

```tsx
import { Block, Layout, OtpCode, Paragraph, Signoff, Title } from '../components';

export const PasswordResetEmail = ({ email, token, resetUrl, expiresInMinutes }: PasswordResetEmailProps) => (
  <Layout>
    <Block>
      <Title>Password reset</Title>
    </Block>
    {/* ... resetUrl link (коли PASSWORD_RESET_URL_BASE задано), OtpCode з токеном ... */}
    <Block disableMargin>
      <Signoff from="Support Team" />
    </Block>
  </Layout>
);
```

UI-примітиви: `libs/infrastructure/src/mail/components/` (`Layout`, `Block`, `Title`, `OtpCode`, …).  
Стилі: `libs/infrastructure/src/mail/config/tailwind-config.tsx`.

**Не** передавайте HTML з use case — лише `template` + `data`.

### Idempotency для templated email jobs

`TemplatedEmailJob` підтримує опційне поле `idempotencyKey`. `EmailProcessor` застосовує атомарний execution claim через `IJobExecutionStore` перед SMTP side effect.

Приклад ключа (welcome email після реєстрації):

```ts
idempotencyKey: `user-registered:${event.id}:welcome`;
```

Потік worker-а:

```txt
acquire(idempotencyKey, executionTtl=300s)
  -> null: вже completed, sent-ambiguous або in-flight — вихід без send
  -> token: render template -> mail.send() (Message-ID з idempotencyKey)
    -> complete(idempotencyKey, token, retentionTtl=30d) при успіху
    -> release(idempotencyKey, token) при помилці до send
    -> markAmbiguousSent + UnrecoverableError після send, якщо ownership втрачено
```

Redis-ключ: `job-execution:<idempotencyKey>`.

| Стан ключа       | Поведінка                                                        |
| ---------------- | ---------------------------------------------------------------- |
| відсутній        | `acquire` повертає token, worker виконує send                    |
| in-flight (UUID) | паралельний `acquire` повертає `null`, duplicate send немає      |
| `completed`      | `acquire` повертає `null` до закінчення retention TTL            |
| `sent-ambiguous` | `acquire` повертає `null` — email вже надіслано, outcome unclear |
| помилка send     | `release` видаляє claim, BullMQ retry може знову `acquire`       |

`RawEmailJob` не має `idempotencyKey` — send виконується без claim (як раніше).

At-least-once семантика (не exactly-once): якщо worker впав після успішного SMTP, але до `complete()` або `markAmbiguousSent()`, можливе дублювання листа (residual crash window). Після send worker перевіряє `complete()`; при failure записує `sent-ambiguous` і завершує job через `UnrecoverableError` без retry — наступний job з тим самим ключем не відправить лист повторно. Для критичних notification flows документуйте це обмеження або додайте durable dedup.

Запуск: Redis + `npm run start:dev:worker` + `MAIL_DRIVER=smtp` (або `null` для dev).

---

## 10. Додати BullMQ job (worker)

### 1. QueueJobRegistry і константа черги

`libs/contracts/src/queues/queue-gateway.ts` — додати queue і typed job payload:

```ts
export interface QueueJobRegistry {
  // ... існуючі outbox, email
  reports: {
    'generate-report': { reportId: string };
  };
}
```

`libs/contracts/src/queues/queue-names.ts`:

```ts
export const QUEUES = {
  OUTBOX: 'outbox',
  EMAIL: 'email',
  REPORTS: 'reports',
} as const;
```

### 2. Реєстрація черги в entrypoint

У `apps/worker/src/worker.module.ts` (або API/Cron, якщо там enqueue):

```ts
InfrastructureBullMqModule.registerQueues([QUEUES.OUTBOX, QUEUES.EMAIL, QUEUES.REPORTS], {
  imports: [bullMqConnectionModule],
});
```

### 3. Processor

`apps/worker/src/processors/report.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '@contracts/queues/queue-names';

@Processor(QUEUES.REPORTS)
export class ReportProcessor extends WorkerHost {
  async process(job: Job<{ reportId: string }>): Promise<void> {
    // Тут не розміщується бізнес-логіка.
    // Processor повинен викликати application use case.
    await this.generateReportUseCase.execute(job.data);
  }
}
```

### 4. Реєстрація processor

`apps/worker/src/worker.module.ts` — додати processor у `providers`.

### 5. Постановка в чергу (з API або cron)

```ts
constructor(@Inject(TOKENS.QueueGateway) private readonly queues: IQueueGateway) {}

await this.queues.add(QUEUES.REPORTS, 'generate-report', { reportId: '...' });
```

Запуск worker:

```bash
npm run start:dev:worker
```

---

## 11. Додати cron-задачу

`apps/cron/src/schedules/my.schedule.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class MySchedule {
  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    // або поставити job у чергу через TOKENS.QueueGateway
  }
}
```

Підключіть у `apps/cron/src/cron.module.ts` → `providers`.

```bash
npm run start:dev:cron
```

---

## 12. Корисні команди

| Задача           | Команда                                      |
| ---------------- | -------------------------------------------- |
| API (dev)        | `npm run start:dev:api`                      |
| Worker (dev)     | `npm run start:dev:worker`                   |
| Cron (dev)       | `npm run start:dev:cron`                     |
| Збірка всіх apps | `npm run build`                              |
| Lint             | `npm run lint`                               |
| Unit-тести       | `npm run test:unit`                          |
| Module bootstrap | `npm run test:module`                        |
| Release policy   | `npm run test:release`                       |
| Повний test gate | `npm run test:all`                           |
| Міграції         | `npm run db:generate` → `npm run db:migrate` |
| Docker           | `docker compose up -d --build`               |
| Health           | `GET http://localhost:3000/health`           |

---

## 13. Підключити infrastructure module окремо

Кожен переносимий модуль (`RedisModule`, `DrizzleModule`, `InfrastructureBullMqModule`, `AuthModule`, `MailModule`, `StorageModule`) реєструється через `forRoot` / `forRootAsync` у composition root потрібного entrypoint.

Повні standalone-приклади: [docs/infrastructure-modules/README.md](./docs/infrastructure-modules/README.md).

Мінімальний приклад для API:

```ts
import { RedisModule } from '@infrastructure/redis/redis.module';
import { AuthModule } from '@infrastructure/auth/auth.module';
import { mapAppConfigToRedisOptions } from '@infrastructure/config/create-starter-kit-module-options';

const redisModule = RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config) => mapAppConfigToRedisOptions(config),
});

@Module({
  imports: [
    InfrastructureConfigModule,
    redisModule,
    AuthModule.forRootAsync({
      imports: [redisModule],
      inject: [AppConfigService],
      useFactory: (config) => ({
        driver: 'jwt',
        passwordSaltRounds: config.auth().passwordSaltRounds,
        jwt: config.jwt(),
      }),
    }),
  ],
})
export class ApiModule {}
```

У production composition root зазвичай створюють один екземпляр `redisModule` і передають його в `AuthModule.forRoot` / `forRootAsync` через `{ imports: [redisModule] }`. Детальніше: [docs/infrastructure-modules/README.md](./docs/infrastructure-modules/README.md#authmodule).

`AppConfigService` залишається на межі composition root; всередині adapter-модулів не використовується.

---

## Чеклист нової feature

- [ ] Domain: сутності / value objects / domain errors
- [ ] Contracts: інтерфейси + `TOKENS` (за потреби)
- [ ] Application: use case(s)
- [ ] Apps: реєстрація use case у composition-модулі потрібного entrypoint
- [ ] Infrastructure: repository, mapper, міграція (за потреби)
- [ ] API: DTO, controller і підключення feature composition-модуля
- [ ] OpenAPI: inputs/requiredness, typed outputs, success/error statuses, auth, headers/cookies та приклади
- [ ] OpenAPI drift test оновлено; `/v1/docs` і `/v1/docs-json` перевірено
- [ ] Guards / rate limit / auth (за потреби)
- [ ] `.env.example` оновлено
- [ ] `npm run lint` і `npm run build:api`

---

## Орієнтир по шарах

```txt
apps/api          → HTTP, DTO, guards, формат відповіді
libs/application  → use cases, оркестрація
libs/contracts    → інтерфейси (порти)
libs/domain       → бізнес-правила, entities
libs/infrastructure → Drizzle, Redis, BullMQ, adapters
```

Референсна реалізація auth: `apps/api/src/controllers/auth.controller.ts`, `libs/application/src/use-cases/auth/`, `libs/infrastructure/src/repositories/user-drizzle.repository.ts`.
