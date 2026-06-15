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

### Крок 7. Перевірка

```bash
npm run start:dev:api
# GET http://localhost:3000/users/<uuid>  + Authorization: Bearer <token>
```

**Правило:** controller → use case → contract (repository). Controller **не** імпортує Drizzle, Redis, `@domain` напряму.

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
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';

constructor(
  @Inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
  @Inject(TOKENS.TransactionManager) private readonly transactionManager: ITransactionManager,
) {}

async execute(input: RegisterInput) {
  const passwordHash = await this.passwordHasher.hash(input.password);

  const user = await this.transactionManager.run(async (trx) => {
    const existing = await this.userRepository.findByEmail(input.email, trx);
    if (existing) throw new ConflictError('USER_ALREADY_EXISTS', 'User already exists');

    const newUser = User.create({ email: input.email, passwordHash });
    await this.userRepository.insert(
      newUser,
      trx,
    );
    return newUser;
  });

  // Redis / email / queue — після commit, не всередині run()
  const auth = await this.authTokenService.createAuthSession({ /* ... */ });
  return { user, auth };
}
```

Зовнішні сервіси (сесія, пошта, S3) **не** тримайте всередині `transactionManager.run()`.

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
curl -X POST http://localhost:3000/auth/login \
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
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <access-token>"
```

### Refresh

```bash
curl -X POST http://localhost:3000/auth/refresh \
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
curl -X POST http://localhost:3000/auth/logout \
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
curl -X POST http://localhost:3000/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<current-refresh-token>"
  }'
```

Refresh-token family все одно буде відкликана.

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
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh

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

Структура листа (як у ваших проєктах):

```tsx
import { Block, Layout, Paragraph, Signoff, Title } from '../components';

export const PasswordResetEmail = ({ resetUrl }: { resetUrl: string }) => (
  <Layout>
    <Block>
      <Title>Reset password</Title>
    </Block>
    <Block>
      <Paragraph>Open this link: {resetUrl}</Paragraph>
    </Block>
    <Block disableMargin>
      <Signoff from="Support Team" />
    </Block>
  </Layout>
);
```

UI-примітиви: `libs/infrastructure/src/mail/components/` (`Layout`, `Block`, `Title`, `OtpCode`, …).  
Стилі: `libs/infrastructure/src/mail/config/tailwind-config.tsx`.

**Не** передавайте HTML з use case — лише `template` + `data`.

Запуск: Redis + `npm run start:dev:worker` + `MAIL_DRIVER=smtp` (або `null` для dev).

---

## 10. Додати BullMQ job (worker)

### 1. Ім'я черги

`libs/contracts/src/queues/queue-names.ts`:

```ts
export const QUEUES = {
  OUTBOX: 'outbox',
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  INTEGRATIONS: 'integrations',
  ANALYTICS: 'analytics',
  FILES: 'files',
  MAINTENANCE: 'maintenance',
} as const;
```

### 2. Processor

`apps/worker/src/processors/my-job.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '@contracts/queues/queue-names';

@Processor(QUEUES.MY_JOB)
export class MyJobProcessor extends WorkerHost {
  async process(job: Job<{ userId: string }>): Promise<void> {
    // Тут не розміщується бізнес-логіка.
    // Processor повинен викликати application use case.
    await this.myJobUseCase.execute(job.data);
  }
}
```

### 3. Реєстрація

`apps/worker/src/worker.module.ts` — додати processor у `providers`.

### 4. Постановка в чергу (з API або cron)

```ts
constructor(@Inject(TOKENS.QueueGateway) private readonly queues: IQueueGateway) {}

await this.queues.add(QUEUES.MY_JOB, 'do-something', { userId: '...' });
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
| Міграції         | `npm run db:generate` → `npm run db:migrate` |
| Docker           | `docker compose up -d --build`               |
| Health           | `GET http://localhost:3000/health`           |

---

## Чеклист нової feature

- [ ] Domain: сутності / value objects / domain errors
- [ ] Contracts: інтерфейси + `TOKENS` (за потреби)
- [ ] Application: use case(s)
- [ ] Apps: реєстрація use case у composition-модулі потрібного entrypoint
- [ ] Infrastructure: repository, mapper, міграція (за потреби)
- [ ] API: DTO, controller і підключення feature composition-модуля
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
