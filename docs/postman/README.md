# Postman collection

Canonical manual-test artifact for the NestJS Backend Foundation Starter public HTTP API.

- **Collection:** [`NestJS-Backend-Foundation-Starter.postman_collection.json`](./NestJS-Backend-Foundation-Starter.postman_collection.json) (Postman Collection v2.1)
- **Local environment:** [`local.postman_environment.json`](./local.postman_environment.json)

OpenAPI (`/v1/docs-json`) remains the canonical **machine** contract. This folder is the canonical **manual-test** artifact and must stay in sync whenever an HTTP endpoint is added or changed.

## Import

1. Open Postman (or a Collection v2.1–compatible client).
2. **Import** → select `NestJS-Backend-Foundation-Starter.postman_collection.json`.
3. Optionally import `local.postman_environment.json` and select that environment.
4. Confirm `baseUrl` is `http://localhost:3000` (or your local API host).

## Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `baseUrl` | API origin | `http://localhost:3000` |
| `accessToken` | JWT access token for Bearer auth | empty |
| `refreshToken` | JWT refresh token (body) | empty |
| `sessionCookieName` | Session cookie name | `sid` |
| `sessionCookieValue` | Session cookie value | empty |
| `resetToken` | Password-reset token | empty |
| `sessionId` | Session UUID path param | fake UUID placeholder |
| `returnUrl` | Google SSO optional return URL | `http://localhost:3000` |
| `googleAuthCode` | OAuth callback `code` placeholder | empty |
| `googleAuthState` | OAuth callback `state` placeholder | empty |

Paste real local tokens/cookie values into the environment for interactive testing. **Do not commit secrets, production URLs, or real JWTs.**

## Dual auth drivers

- **JWT (`AUTH_DRIVER=jwt`):** use `Authorization: Bearer {{accessToken}}` on protected routes. Refresh/logout send `{{refreshToken}}` in JSON.
- **Session (`AUTH_DRIVER=session`):** send Cookie `{{sessionCookieName}}={{sessionCookieValue}}`. All `/v1/sessions/*` routes require the session driver; under JWT they return `400 SESSION_DRIVER_REQUIRED`.

Protected Auth examples include both Bearer and cookie variants where useful (for example `Me`).

## Folders and coverage

| Folder | Routes |
| --- | --- |
| Auth | `/v1/auth/*` register, login, logout, refresh, me, change/forgot/reset password |
| Google Auth | `/v1/auth/google`, `/v1/auth/google/callback` (browser redirect; included for inventory) |
| Sessions | `/v1/sessions`, `/v1/sessions/others`, `/v1/sessions/{{sessionId}}` |
| Health | `/health`, `/health/live`, `/health/ready` (no `v1` prefix) |

Path params use Postman `{{sessionId}}`; OpenAPI uses `{id}`. Coverage tests normalize both forms.

## Keep in sync

Any task or bugfix that **adds or changes an HTTP endpoint** must update this collection (and OpenAPI) in the same change set. Run:

```bash
npm run test:postman-coverage
```

That asserts every OpenAPI path+method appears in the collection.
