# Auth Module

## Призначення

`Auth Module` — це базовий модуль авторизації та автентифікації користувачів.

Він відповідає за:

- реєстрацію користувача;
- логін користувача;
- отримання поточного авторизованого користувача;
- хешування паролів;
- створення авторизаційної сесії;
- перевірку доступу до захищених endpoint-ів;
- підтримку ролей;
- можливість перемикання між `JWT` та `session` режимом авторизації.

Головна ідея модуля — дати starter-проєкту базову, але правильну foundation-авторизацію, яку можна переносити між різними NestJS-проєктами.

---

# 1. Які режими авторизації підтримуються

Модуль підтримує два режими:

```txt
jwt
session
```

Режим вибирається на рівні `.env`:

```env
AUTH_DRIVER=jwt
```

або:

```env
AUTH_DRIVER=session
```

## JWT mode

JWT mode використовується, коли клієнт зберігає access token і передає його в кожному запиті через header:

```http
Authorization: Bearer <accessToken>
```

Цей режим зручний для:

- SPA frontend;
- mobile app;
- public API;
- stateless API;
- мікросервісної архітектури.

При login/register користувач отримує:

```json
{
  "accessToken": "jwt-access-token",
  "refreshToken": "jwt-refresh-token"
}
```

## Session mode

Session mode використовується, коли backend створює session id і зберігає сесію в Redis.

Клієнт отримує cookie:

```txt
sid=<sessionId>
```

Цей режим зручний для:

- класичних web-додатків;
- backend-rendered apps;
- систем, де потрібно легко відкликати сесію;
- випадків, де важливо контролювати активні сесії користувача.

---

# 2. Де знаходиться модуль

Auth module розділений по шарах архітектури.

```txt
libs/
  domain/
    src/
      entities/
        user.entity.ts
      value-objects/
        email.vo.ts
      errors/

  application/
    src/
      use-cases/
        auth/
          register.usecase.ts
          login.usecase.ts
          logout.usecase.ts
          get-current-user.usecase.ts

  contracts/
    src/
      auth/
        auth-token.service.ts
        password-hasher.service.ts
        session-store.service.ts
        current-user.ts
      repositories/
        user.repository.ts

  infrastructure/
    src/
      auth/
        auth.module.ts
        jwt-auth-token.service.ts
        session-auth-token.service.ts
        bcrypt-password-hasher.service.ts
        redis-session-store.service.ts

apps/
  api/
    src/
      controllers/
        auth.controller.ts
      dto/
        auth/
          register.dto.ts
          login.dto.ts
      guards/
        auth.guard.ts
        roles.guard.ts
      decorators/
        current-user.decorator.ts
        roles.decorator.ts
        public.decorator.ts
```

---

# 3. Архітектурна ідея

Auth module побудований за тими ж правилами, що й інші модулі starter-а.

## Domain

`domain` містить чисту бізнес-модель користувача.

Тут знаходиться:

```txt
User entity
Email value object
Domain errors
```

Domain не знає нічого про:

- JWT;
- Redis;
- bcrypt;
- HTTP;
- cookies;
- NestJS guards.

## Application

`application` містить use-cases:

```txt
RegisterUseCase
LoginUseCase
LogoutUseCase
GetCurrentUserUseCase
```

Use-case не знає, який саме режим авторизації використовується: `jwt` чи `session`.

Він працює тільки через contracts:

```txt
IUserRepository
IPasswordHasher
IAuthTokenService
ISessionStore
```

## Contracts

`contracts` описують інтерфейси, через які application працює із зовнішнім світом.

Основні контракти:

```txt
IAuthTokenService
IPasswordHasher
ISessionStore
IUserRepository
```

## Infrastructure

`infrastructure` містить конкретні реалізації:

```txt
BcryptPasswordHasher
JwtAuthTokenService
SessionAuthTokenService
RedisSessionStore
```

Саме тут вирішується, як створювати auth session:

- через JWT;
- або через Redis session.

## API

`apps/api` містить HTTP endpoint-и, guards, decorators і DTO.

Controller не містить бізнес-логіки. Він тільки приймає request, викликає use-case і повертає response.

---

# 4. Env налаштування

У `.env.example` потрібно додати:

```env
# Auth
AUTH_DRIVER=jwt
AUTH_SESSION_TTL_SECONDS=604800

JWT_SECRET=dev-secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=dev-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d

PASSWORD_SALT_ROUNDS=10
```

## Опис змінних

### `AUTH_DRIVER`

Визначає, який режим авторизації використовує додаток.

Можливі значення:

```txt
jwt
session
```

### `AUTH_SESSION_TTL_SECONDS`

Час життя session у Redis в секундах.

Приклад:

```env
AUTH_SESSION_TTL_SECONDS=604800
```

`604800` секунд — це 7 днів.

### `JWT_SECRET`

Секретний ключ для підпису access token.

У production він має бути складним і безпечним.

### `JWT_REFRESH_SECRET`

Окремий секретний ключ для refresh token.

Бажано не використовувати той самий secret, що й для access token.

### `PASSWORD_SALT_ROUNDS`

Кількість rounds для bcrypt-хешування пароля.

Для development можна використовувати:

```env
PASSWORD_SALT_ROUNDS=10
```

Для production можна збільшити значення, але важливо не зробити login/register занадто повільними.

---

# 5. Основні endpoint-и

Auth module додає базові endpoint-и:

```txt
POST /auth/register
POST /auth/login
GET /auth/me
```

Опціонально пізніше можна додати:

```txt
POST /auth/logout
POST /auth/refresh
POST /auth/change-password
POST /auth/forgot-password
POST /auth/reset-password
GET /auth/sessions
DELETE /auth/sessions/:id
```

---

# 6. Реєстрація користувача

Endpoint:

```http
POST /auth/register
Content-Type: application/json
```

Body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Що відбувається всередині:

```txt
1. AuthController приймає DTO
2. RegisterUseCase перевіряє, чи користувач уже існує
3. PasswordHasher хешує пароль
4. User entity створюється в domain-шарі
5. UserRepository зберігає користувача в базу
6. AuthTokenService створює JWT tokens або session
7. API повертає користувача і auth-дані
```

Приклад відповіді для `AUTH_DRIVER=jwt`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "roles": ["user"]
    },
    "auth": {
      "accessToken": "jwt-access-token",
      "refreshToken": "jwt-refresh-token"
    }
  }
}
```

Приклад відповіді для `AUTH_DRIVER=session`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "roles": ["user"]
    },
    "auth": {
      "sessionId": "session-id",
      "expiresAt": "2026-06-08T12:00:00.000Z"
    }
  }
}
```

У session mode API також може встановити cookie:

```txt
sid=session-id
```

---

# 7. Логін користувача

Endpoint:

```http
POST /auth/login
Content-Type: application/json
```

Body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Що відбувається всередині:

```txt
1. AuthController приймає email/password
2. LoginUseCase шукає користувача по email
3. PasswordHasher порівнює пароль з password_hash
4. Якщо пароль правильний — AuthTokenService створює JWT tokens або session
5. API повертає auth-дані
```

Якщо email або пароль неправильний, API повертає помилку авторизації.

---

# 8. Отримання поточного користувача

Endpoint:

```http
GET /auth/me
```

## Для JWT mode

Потрібно передати access token:

```http
Authorization: Bearer <accessToken>
```

## Для session mode

Потрібно передати cookie:

```http
Cookie: sid=<sessionId>
```

Що відбувається всередині:

```txt
1. AuthGuard читає Bearer token або sid cookie
2. AuthTokenService перевіряє token/session
3. Якщо користувач валідний — guard додає user в request
4. Controller через CurrentUser decorator отримує user
5. GetCurrentUserUseCase повертає актуальні дані користувача
```

Приклад відповіді:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "roles": ["user"]
  }
}
```

---

# 9. Як захистити endpoint

Щоб endpoint був доступний тільки авторизованому користувачу, потрібно використати `AuthGuard`.

```ts
@UseGuards(AuthGuard)
@Get('profile')
async profile(@CurrentUser() user: RequestUser) {
  return {
    success: true,
    data: user,
  };
}
```

`AuthGuard` працює в обох режимах:

```txt
AUTH_DRIVER=jwt
AUTH_DRIVER=session
```

У JWT mode він читає:

```http
Authorization: Bearer <token>
```

У session mode він читає:

```http
Cookie: sid=<sessionId>
```

---

# 10. Як отримати поточного користувача в controller

Для цього використовується decorator:

```ts
@CurrentUser()
```

Приклад:

```ts
@UseGuards(AuthGuard)
@Get('me')
async me(@CurrentUser() user: RequestUser) {
  return user;
}
```

`RequestUser` має базову структуру:

```ts
export type RequestUser = {
  id: string;
  email: string;
  roles: string[];
};
```

---

# 11. Як обмежити endpoint по ролі

Для перевірки ролей використовується:

```txt
RolesGuard
Roles decorator
```

Приклад endpoint-а тільки для admin:

```ts
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
@Get('admin')
async adminOnly() {
  return {
    success: true,
    message: 'Admin access granted',
  };
}
```

Як це працює:

```txt
1. AuthGuard перевіряє, що користувач авторизований
2. AuthGuard додає user в request
3. RolesGuard перевіряє roles користувача
4. Якщо потрібної ролі немає — повертається Forbidden
```

---

# 12. Як працює AuthGuard

`AuthGuard` — це єдиний guard для JWT і session режимів.

Він робить такі кроки:

```txt
1. Читає Authorization header
2. Якщо є Bearer token — використовує його
3. Якщо Bearer token немає — шукає sid cookie
4. Передає token або sessionId в AuthTokenService
5. AuthTokenService перевіряє авторизацію
6. Якщо все добре — user додається в request
7. Якщо ні — повертається Unauthorized
```

Завдяки цьому controller не знає, який режим авторизації використовується.

---

# 13. Як працює JWT mode

Якщо в `.env` стоїть:

```env
AUTH_DRIVER=jwt
```

Тоді `AuthModule` підставляє реалізацію:

```txt
JwtAuthTokenService
```

Flow:

```txt
Register/Login
  -> JwtAuthTokenService створює accessToken і refreshToken
  -> клієнт зберігає token
  -> наступні запити йдуть з Authorization: Bearer token
  -> AuthGuard перевіряє token
```

Плюси:

- простіше масштабувати;
- не потрібно зберігати session на backend;
- зручно для mobile і SPA.

Мінуси:

- складніше миттєво відкликати access token;
- потрібно правильно організувати refresh token flow;
- потрібно уважно працювати з безпекою зберігання токенів.

---

# 14. Як працює Session mode

Якщо в `.env` стоїть:

```env
AUTH_DRIVER=session
```

Тоді `AuthModule` підставляє реалізацію:

```txt
SessionAuthTokenService
```

Flow:

```txt
Register/Login
  -> SessionAuthTokenService створює sessionId
  -> RedisSessionStore зберігає session в Redis
  -> API ставить cookie sid
  -> наступні запити йдуть з cookie sid
  -> AuthGuard перевіряє sessionId через Redis
```

Плюси:

- легко зробити logout;
- легко відкликати сесію;
- можна бачити активні сесії;
- добре підходить для web apps.

Мінуси:

- потрібен Redis або інше session storage;
- backend стає stateful;
- потрібно правильно налаштувати cookies, CORS і CSRF-захист.

---

# 15. Як підключити AuthModule

`AuthModule` знаходиться в infrastructure-шарі:

```txt
libs/infrastructure/src/auth/auth.module.ts
```

Його потрібно додати в `InfrastructureModule`.

```ts
@Module({
  imports: [
    AuthModule,
    // інші infrastructure modules
  ],
  exports: [
    AuthModule,
    // інші infrastructure modules
  ],
})
export class InfrastructureModule {}
```

Після цього `ApplicationModule` зможе використовувати contracts:

```txt
TOKENS.PasswordHasher
TOKENS.AuthTokenService
TOKENS.SessionStore
```

А `apps/api` зможе використовувати `AuthGuard`.

---

# 16. Як додати AuthController

У `ApiModule` потрібно додати controller:

```ts
@Module({
  imports: [InfrastructureModule, ApplicationModule],
  controllers: [AuthController],
})
export class ApiModule {}
```

AuthController відповідає за HTTP endpoints:

```txt
POST /auth/register
POST /auth/login
GET /auth/me
```

---

# 17. Як оновити users table

Для auth module користувач має зберігати пароль і ролі.

У `users` таблиці мають бути поля:

```txt
id
email
password_hash
roles
created_at
updated_at
```

Приклад Drizzle schema:

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),

  email: varchar('email', { length: 255 }).notNull().unique(),

  passwordHash: varchar('password_hash', { length: 255 }).notNull(),

  roles: jsonb('roles').$type<string[]>().notNull().default(['user']),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Після зміни schema потрібно створити міграцію:

```bash
npm run db:generate
```

І застосувати її:

```bash
npm run db:migrate
```

У Docker:

```bash
docker compose run --rm migrations
```

---

# 18. Як протестувати AuthModule

## Register

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

## Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

## Me через JWT

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

## Me через session cookie

```bash
curl http://localhost:3000/auth/me \
  -H "Cookie: sid=<sessionId>"
```

---

# 19. Безпека

Для production важливо:

- використовувати складний `JWT_SECRET`;
- використовувати окремий `JWT_REFRESH_SECRET`;
- не зберігати plain password;
- зберігати тільки `password_hash`;
- використовувати `httpOnly` cookies для session;
- використовувати `secure: true` cookies на HTTPS;
- налаштувати `sameSite`;
- додати CSRF-захист для cookie-based session;
- додати rate limit на login/register;
- не повертати детальні помилки типу “email exists” у login;
- додати audit log для login/logout;
- додати lockout або throttle після багатьох невдалих login-спроб.

---

# 20. Рекомендований мінімальний набір

Для базового starter-а достатньо реалізувати:

```txt
POST /auth/register
POST /auth/login
GET /auth/me

AuthGuard
RolesGuard
CurrentUser decorator
Roles decorator

JWT auth mode
Session auth mode через Redis
Bcrypt password hashing
```

Цього достатньо, щоб новий проєкт одразу мав базову авторизацію і міг захищати приватні endpoint-и.

---

# 21. Подальше розширення

Пізніше AuthModule можна розширити такими можливостями:

```txt
POST /auth/refresh
POST /auth/logout
POST /auth/change-password
POST /auth/forgot-password
POST /auth/reset-password
GET /auth/sessions
DELETE /auth/sessions/:id
POST /auth/verify-email
POST /auth/resend-verification-email
```

Також можна додати:

```txt
2FA
OTP login
OAuth login через Google/GitHub
device sessions
refresh token rotation
JWT blacklist
permission-based access control
```

---

# 22. Коротко

AuthModule додає до starter-а базову авторизацію.

Він дозволяє:

```txt
реєструвати користувачів
логінити користувачів
отримувати поточного користувача
захищати endpoint-и
перевіряти ролі
обирати JWT або session режим через .env
```

Модуль побудований так, щоб application не залежів від конкретної реалізації авторизації. JWT і session — це лише infrastructure adapters, які можна замінити або розширити без переписування бізнес-логіки.
