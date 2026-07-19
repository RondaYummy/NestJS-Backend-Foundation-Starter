# HTTP parity matrix (legacy `OLD_BACKEND` → starter)

Binding artifact for TASK-002 AC-01/AC-02 (FR-01, FR-06). One section per legacy controller, one row per route. **67 routes across 12 controllers.**

Column legend:

- **Auth** — legacy guard mode:
  - `Public` — no `@Auth` decorator, no guard;
  - `Optional JWT` — `@Auth(UserRole.All)`: `JwtAuthGuard` runs but a missing/invalid token does **not** reject the request (`req.user` may be absent);
  - `JWT (User, Admin)` / `JWT (Admin)` — token required, role checked; banned users get 403;
  - `+ Permissions(X)` — `PermissionsGuard` additionally resolves the campaign from `params.campaignId`/`query.campaignId` and checks per-campaign `accessRights` (owner always passes; `ONLY_OWNER` restricts to owner).
- **D6 flag** — row intersects an intentional break documented in [`D6_BREAKS.md`](D6_BREAKS.md); the "Known error behavior" column records the *legacy* behavior which is **not** to be reproduced.
- **TASK owner** — the migration task that must implement the route (`docs/agent-tasks/`).

Route paths include the controller prefix; the legacy app has no global prefix (`OLD_BACKEND/src/main.ts`).

## Auth transport (legacy observed) — FR-06 / D2

> **Deferred:** target cookie names are NOT frozen by this document. They are decided when `TASK-003` is approved (D2 allows configurable names that *may* match the legacy ones). Everything below is *legacy observed* behavior only.

- Access JWT is accepted from **either** the `auth-cookie` cookie **or** the `Authorization: Bearer <token>` header (`OLD_BACKEND/src/v1/auth/jwt.strategy.ts` uses `fromExtractors([cookie extractor, fromAuthHeaderAsBearerToken()])`, cookie first).
- Refresh JWT is read **only** from the `refresh-cookie` cookie, and only by `GET /v1/auth/refresh` (plus login flows which revoke the old refresh token if the cookie is present).
- Cookies set by login/register/refresh flows (`auth.service.ts::setAuthCookies`):
  - `auth-cookie` = access token; `httpOnly`, `sameSite=lax`, `secure` in production, `domain=FRONTEND_DOMAIN`, expires ≈5 min (`COOKIES_ACCESS_EXPIRATION` maxAge);
  - `refresh-cookie` = refresh token; same attributes, expires ≈2 months (`COOKIES_REFRESH_EXPIRATION` maxAge).
- `POST /v1/auth/log-out` clears both cookies and sets an `Authorization: null` response header.
- Socket.IO handshake (see [`SIDE_EFFECTS.md`](SIDE_EFFECTS.md)) accepts the access token from `handshake.auth.token`, the `Authorization` header, or the `auth-cookie` cookie, in that order.
- Token payload (both tokens): `{ email, id, role }` signed with `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET`; the passport strategy maps it to `req.user = { email, userId, role }`.

## 1. `v1.controller.ts` — `@Controller('v1')` (9 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/status` | Public | — | Text: `***<PKG_NAME>***<br>::OK::<NODE_ENV>::<version>::OK::` | 500 if env vars missing (unhandled `TypeError`) | TASK-019 | — |
| GET | `/v1/privatbank-exchange` | Public | — | PrivatBank JSON passthrough: array of `{ ccy, base_ccy, buy, sale }` | 503 `ServiceUnavailableException` after 7 s timeout + 2 retries | TASK-019 | — |
| GET | `/v1/profile` | JWT (User, Admin) | — | `User` object (see JSON example below); `password` manually set `undefined` | 401 without token | TASK-004 | D6 (sanitization is manual/partial; see D6-01) |
| GET | `/v1/city/:limit` | Public | param `limit`; query `searchValue?` | `City[]` (`id, object_category, object_name, region, priority, …`) | — | TASK-005 | — |
| GET | `/v1/user-city` | Public | query `searchValue?` | `City[]` (closest/matching cities) | — | TASK-005 | — |
| POST | `/v1/push-subscribe` | JWT (User, Admin) | body: Web Push subscription `{ endpoint, expirationTime?, keys: { auth, p256dh } }` | Bare `200` (`res.sendStatus(200)`); also stores sub, links it to the user and immediately sends a greeting push | 500 on invalid subscription payload | TASK-016 | — |
| DELETE | `/v1/push-unsubscribe` | JWT (User, Admin) | body: `{ endpoint }` | `true` | 500 `TypeError` when endpoint unknown (`deletePushMessage` dereferences before null check) | TASK-016 | — |
| POST | `/v1/feedback` | Public (no guard) | body: `Feedback` fields `{ firstName?, lastName?, phoneNumber?, description?, agreePolicys?, rating? }` | `true`; **persistence is commented out** in OLD (D5 as-is quirk, human decision pending in TASK-017); notification branch requires `req.user` which is never set (no guard) | — | TASK-017 | — |
| GET | `/v1/utils/aggregate-search` | Public | query `searchValue` (required), `city` (JSON string `{ object_name }`), `type` (ignored) | `{ campaigns, services, workers }` | Returns `200` with empty body when `city` missing or on any thrown error (error only logged) | TASK-019 | D6 (Error-as-200 / swallowed errors; see D6-03) |

### `/v1/profile` success example (auth-sensitive identity response)

```json
{
  "id": "0b0f6a3e-…",
  "email": "user@example.com",
  "noPassword": false,
  "photo": "https://<bucket>.s3.…amazonaws.com/…",
  "firstName": "Ім'я",
  "lastName": "Прізвище",
  "phone": "+380…",
  "gender": "male",
  "birthDate": "1990-01-01",
  "role": "User",
  "status": "Active",
  "latestLogins": [{ "platform": "…", "versionNumber": 1, "name": "…", "createdAt": 0, "desktop": true }],
  "favorites": [{ "type": "…", "itemId": "…" }],
  "verify": false,
  "pushSubscribesIds": ["…"],
  "city": { "id": "…", "object_category": "Місто", "object_name": "…", "region": "…", "priority": 1 },
  "settings": { "notifications": {}, "emails": {}, "push": {} },
  "workerRankingSystem": 0,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`password` is set to `undefined` before returning (dropped from JSON). Relations not loaded by `getByEmail` are absent.

## 2. `v1/auth/v1.auth.controller.ts` — `@Controller('v1/auth')` (8 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/auth/login` | Public | body `LoginUserDto`: `{ login: { email? \| phone? }, password }` | `200`; sets `auth-cookie` + `refresh-cookie`; returns the validated `User` **including the bcrypt `password` hash** (loaded via `getUserWithPassword`) | 404 `Перевірте введені дані` (unknown login), 404 `Не правильні дані користувача` (bad password) | TASK-003 | D6 (password hash leak; see D6-01) |
| POST | `/v1/auth/login/admin` | Public | body: `{ email, password, sessionObject: SessionObjectDto }` | `200`; sets both cookies; records session in `latestLogins`; returns admin `User` **including password hash** | 404 `Перевірте введені дані` on missing fields / unknown admin / bad password | TASK-003 | D6 (password hash leak; see D6-01) |
| GET | `/v1/auth/google` | Public (Google OAuth guard) | — | 302 redirect to Google consent | — | TASK-003 | — |
| GET | `/v1/auth/google/redirect` | Public (Google OAuth guard) | Google callback params | HTML `<script>` that `postMessage`s `{ source: POPUP_SECRET_KEY, …validatedUser, isSocialConnect: true }` to `window.opener` and closes the popup; sets both cookies unless user is `Banned`; CSP + COOP headers set | — | TASK-003 | D6 (user object spread into postMessage payload; see D6-01) |
| POST | `/v1/auth/reg` | Public | body `CreateUserDto`: `{ email, password, phone, photo?, firstName?, lastName? }` | Created `User` as returned by registration | Registration validation errors from service | TASK-003 | D6 (created user returned unsanitized; see D6-01) |
| GET | `/v1/auth/refresh` | Public (needs `refresh-cookie`) | cookie `refresh-cookie` | `200`, body `true`; sets fresh `auth-cookie` + `refresh-cookie`; old refresh token revoked | 401 `Invalid refresh` (missing/invalid/already-used cookie) | TASK-003 | — |
| POST | `/v1/auth/log-out` | JWT (User, Admin) | cookies | `200`, body `true`; clears `auth-cookie` + `refresh-cookie`; response header `Authorization: null` | 404 `Cookies does not exist` when no cookies | TASK-003 | — |
| POST | `/v1/auth/change-password` | JWT (User, Admin) | body `ChangePassword`: `{ currentPassword, newPassword }` | String `"OK"` | 400 `Ой... Щось пішло не так.` (missing `newPassword`), 404 `Не правильні дані користувача` (wrong current password) | TASK-003 | — |

### `/v1/auth/login` success example (legacy observed — the `password` field is the D6-01 leak)

```json
{
  "id": "0b0f6a3e-…",
  "email": "user@example.com",
  "password": "$2b$10$…bcrypt-hash…",
  "noPassword": false,
  "photo": null,
  "firstName": "Ім'я",
  "lastName": "Прізвище",
  "phone": "+380…",
  "role": "User",
  "status": "Active",
  "verify": false,
  "…": "remaining User columns loaded by getUserWithPassword"
}
```

Target behavior (D6-01): same top-level `User` shape **without** `password` (and without other secret material).

## 3. `v1/v1-users.controller.ts` — `@Controller('v1/users')` (9 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/users/` | JWT (User, Admin) | query `searchValue?`, `limit?`, `skip?` | `User[]` matching search | — | TASK-004 | — |
| POST | `/v1/users/update-user` | JWT (User, Admin) | body `UpdateMainUserDataDto`: `{ firstName, lastName, phone, newUserPhoto?(base64), gender?, email?, birthDate? }` | Updated `User`; when `newUserPhoto` present: old S3 photo deleted, new base64 uploaded to S3 | Validation 400s from DTO | TASK-004 (+ TASK-006 for S3 wiring) | — |
| POST | `/v1/users/change-email` | JWT (User, Admin) | body `UpdateUserEmailDto`: `{ newEmail, password }` | Updated user data | 400 `Будь ласка, введіть коректну електронну адресу.` (regex fail), 400 wrong password | TASK-004 | — |
| POST | `/v1/users/set-password` | JWT (User, Admin) | body `{ password }` | `true` | 400 `Password must be 8 length` (< 8 chars), 400 `The password is already set` | TASK-004 | — |
| POST | `/v1/users/change-city` | Optional JWT | body `SetUserCityDto`: `{ city }` | `true` | — (requires a user id from token to be useful) | TASK-004 | — |
| POST | `/v1/users/restore-password` | Optional JWT (effectively public) | body `{ email }` | Result of `restoreUserPassword` (restore code created, confirmation mail sent) | — | TASK-004 | — |
| POST | `/v1/users/restore-password/check` | Optional JWT (effectively public) | body `{ signature, email }` | The matched restore/user record returned by `checkRestorePasswordCode` | Error when signature invalid | TASK-004 | D6 (identity data returned to unauthenticated caller; see D6-01) |
| POST | `/v1/users/restore-password/setup` | Optional JWT (effectively public) | body `{ signature, email, password }` | Result of `restorePasswordSuccessMessage` (success mail sent); password re-hashed, restore code removed | Error when signature invalid | TASK-004 | — |
| PATCH | `/v1/users/settings` | JWT (Admin, User) | body `UpdateUserSettingsDto`: `{ settingName (enum), value (bool) }` | Updated settings result | Validation 400s | TASK-004 | — |

## 4. `v1/v1-campaigns.controller.ts` — `@Controller('v1/campaigns')` (8 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/campaigns/` | JWT (User, Admin) | body `CreateCampaignDto`: name/city/contact fields, `photo` (base64), `photoPreviews[]` (base64), `services[]` (each with `photoPreviews[]`) | Saved `Campaign` incl. created `services[]` and S3-hosted `qrCode` | **`catch` returns the `Error` object with HTTP 200** | TASK-007 (+ TASK-006 for S3 wiring) | D6 (Error-as-200; see D6-03) |
| GET | `/v1/campaigns/qr-code/:campaignId` | Optional JWT | param `campaignId` | Base64 data-URL QR string | — | TASK-007 | — |
| GET | `/v1/campaigns/profitable` | Optional JWT | query `limit?` (default 4), `city?` | Profitable campaigns list (`CampaignsWithCityResponseDto`) | — | TASK-007 | — |
| GET | `/v1/campaigns/:campaignId` | Optional JWT | param `campaignId` | `Campaign` + `userRights: string[]`; `accessRights` stripped (`undefined`) | — | TASK-007 | — |
| DELETE | `/v1/campaigns/:id/worker/:workerId` | JWT (User, Admin) | params `id`, `workerId` | `Boolean` | — | TASK-008 | — |
| POST | `/v1/campaigns/:id/worker/:workerId` | JWT (User, Admin) | params `id`, `workerId` | `Boolean` | — | TASK-008 | — |
| GET | `/v1/campaigns/:limit/:skip` | Optional JWT | params `limit`, `skip`; query `name?`, `cityId?` | Paginated campaigns (`items`, counters) | — | TASK-007 | — |
| GET | `/v1/campaigns/:id/with-permissions` | Optional JWT | param `id` | `Campaign` + `userRights: string[]`; `accessRights` stripped | — | TASK-007 | — |

## 5. `v1/v1-campaigns-admin.controller.ts` — `@Controller('v1/adm-campaigns')` (11 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/adm-campaigns/:campaignId/privileges` | JWT + Permissions(`CAMPAIGN_PRIVILEGES_READ`) | param `campaignId` | Campaign object + `userRights[]`; `masters` filtered to exclude caller and owner | 403 when guard fails | TASK-008 | — |
| POST | `/v1/adm-campaigns/:campaignId/privileges/:userId` | JWT + Permissions(`CAMPAIGN_PRIVILEGES_UPDATE`) | params `campaignId`, `userId`; body: map `{ [permissionName]: boolean }` | `true`; updates `accessRights`, emits in-app notification to affected user | 403 own/owner rights; 400 24-hour rate-limit message; all thrown errors re-wrapped as 400 | TASK-008 | — |
| GET | `/v1/adm-campaigns/my` | JWT (User, Admin) | — | `{ owner: Campaign[], withPermissions: Campaign[] }` | — | TASK-008 | — |
| GET | `/v1/adm-campaigns/:campaignId/records` | JWT + Permissions(`CAMPAIGN_APPOINTMENT_READ`) | param `campaignId`; query `start`, `end`, `master?` | Campaign appointment records for all workers | 403 when guard fails | TASK-008 | — |
| PUT | `/v1/adm-campaigns/:campaignId` | JWT + Permissions(`CAMPAIGN_DATA_UPDATE`) | param `campaignId`; body `UpdateDataCampaignDto` | `true` | 403 when guard fails | TASK-008 | — |
| POST | `/v1/adm-campaigns/:campaignId/services` | JWT + Permissions(`CAMPAIGN_SERVICES_CREATE`) | param `campaignId`; body `CampaignServiceItemDto[]` | Created services | 403 when guard fails | TASK-008 | — |
| DELETE | `/v1/adm-campaigns/:campaignId/services` | JWT + Permissions(`CAMPAIGN_SERVICES_DELETE`) | param `campaignId`; query `serviceId` | The deleted `serviceId` string | 403 when guard fails | TASK-008 | — |
| PUT | `/v1/adm-campaigns/:campaignId/services/:serviceId` | JWT + Permissions(`CAMPAIGN_SERVICES_UPDATE`) | params `campaignId`, `serviceId`; body `UpdateCampaignServiceDto` | Updated service | 403 when guard fails | TASK-008 | — |
| POST | `/v1/adm-campaigns/services/worker` | JWT + Permissions(`CAMPAIGN_SERVICES_UPDATE`) | query `serviceId`, `campaignId`, `masterId` | Result of attaching worker to service | 403 when guard fails (campaignId from query) | TASK-008 | — |
| DELETE | `/v1/adm-campaigns/services/worker` | JWT + Permissions(`CAMPAIGN_SERVICES_UPDATE`) | query `serviceId`, `campaignId` (`masterId` in type but unused by route decorators) | Result of detaching worker from service | 403 when guard fails | TASK-008 | — |
| DELETE | `/v1/adm-campaigns/:campaignId` | JWT + Permissions(`ONLY_OWNER`) | param `campaignId` | Result of setting campaign status `Deleted` (soft delete) | 403 non-owner | TASK-008 | — |

## 6. `v1/v1-campaigns-vip.controller.ts` — `@Controller('v1/campaigns/vip')` (1 route)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/campaigns/vip/dashboard` | Optional JWT | — | `Campaign[]` — first 4 campaigns; **stub**: no real VIP filter, shuffle branch effectively dead (D5 as-is) | — | TASK-007 | — |

## 7. `v1/v1-services.controller.ts` — `@Controller('v1/services')` (1 route)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/services/profitable` | Optional JWT | query `limit`, `cityId?` | Profitable services array | — | TASK-007 | — |

## 8. `v1/v1-workers.controller.ts` — `@Controller('v1/workers')` (2 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/workers/:id` | Public (no guard) | param `id` | Full `User` entity of the worker (incl. `master[]` campaigns) | 400 `Такого працівника не знайдено…` when user has no `master[]` | TASK-009 | D6 (full user entity exposed publicly; see D6-01) |
| GET | `/v1/workers/:id/services` | Public (no guard) | param `id`; query `campaignId`, `skip?`, `limit?` | Worker services list filtered by campaign | — | TASK-009 | — |

## 9. `v1/v1-schedule.controller.ts` — `@Controller('v1/schedule')` (2 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/schedule/:campaignId` | JWT + Permissions(`CAMPAIGN_WORKERS_WORK_SCHEDULE_CREATE`) | param `campaignId`; query `masterId`; body `SetScheduleDto`: `{ type, selectedDate?, startEndDates[2], startTime?, endTime? }` | `{ success: true }`; appends exclusion to `scheduleMasters[].exclusion`, notifies master if not self | 400 `#4998` invalid dates; 404 `#4999` master schedule missing; 400 `#5000/#5001/#5002` overlapping events | TASK-010 | — |
| PUT | `/v1/schedule/` | JWT + Permissions(`CAMPAIGN_WORKERS_WORK_SCHEDULE_UPDATE`) | query `campaignId`, `masterId`; body `{ main: DefaultScheduleDto, break: DefaultScheduleDto }` | Empty body (`undefined`, 200); silently no-ops when master not found | 400 `Incorrect or not transmitted time` | TASK-010 | — |

## 10. `v1/v1-appointments.controller.ts` — `@Controller('v1/appointments')` (2 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/appointments/` | JWT (User, Admin) | body `CreateAppointmentDto` (master, services, campaign, timestamp/duration) | Created appointment; side effect: mail `sendAppointmentToMaster` to the master | Service-level errors surface per implementation (see D6-03 for Error-as-200 audit) | TASK-011 | — |
| POST | `/v1/appointments/exclusions` | Public (no guard) | body `{ masterId, serviceIds[], campaignId }` | Slot-exclusion data for booking calendar | — | TASK-011 | — |

## 11. `v1/v1-comments.controller.ts` — `@Controller('v1/comments')` (4 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/comments/` | Optional JWT | body `CommentItem`: `{ type, masterId?, campaignId?, serviceId?, review, from, anonymous?, rating? }` — **`from` (author) is client-supplied** | Created comment | — | TASK-012 | D6 (author spoofing via body `from`; see D6-02) |
| GET | `/v1/comments/:itemId` | Optional JWT | param `itemId`; query `type` (required), `skip?`, `limit?`, `ratings?[]` | `{ …itemsAndCount, maxPages }` | **`catch` returns the `Error` object with HTTP 200** | TASK-012 | D6 (Error-as-200; see D6-03) |
| GET | `/v1/comments/can-do/:itemId` | JWT (User, Admin) | param `itemId`; query `type` | Boolean (may the user add a comment) | **`catch` returns the `Error` object with HTTP 200** | TASK-012 | D6 (Error-as-200; see D6-03) |
| DELETE | `/v1/comments/:commentId` | JWT (Admin) | param `commentId` | Result of hiding comment (soft hide flag) | — | TASK-012 | — |

## 12. `v1/v1-admin.controller.ts` — `@Controller('v1/admin')` (10 routes)

| Method | Path | Auth | Key request fields | Success shape (top-level) | Known error behavior | TASK owner | D6 flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/admin/` | JWT (Admin) | — | String `admin get success` | 401/403 non-admin | TASK-014 | — |
| GET | `/v1/admin/counters` | JWT (Admin) | — | `{ users, campaigns, admins, feedbacks }` | — | TASK-014 | — |
| GET | `/v1/admin/feedbacks` | JWT (Admin) | query `skip?`, `limit?`, `status?` | `Feedback[]` | — | TASK-014 (persistence: TASK-017) | — |
| POST | `/v1/admin/feedback/:id` | JWT (Admin) | param `id`; body `{ action }` (a `FeedbackStatus` key) | Updated `Feedback` | 400 `Не правильний або не переданий action`; 400 missing id | TASK-014 (persistence: TASK-017) | — |
| GET | `/v1/admin/admins-list` | JWT (Admin) | query `skip?`, `limit?` | `User[]` (admins) | — | TASK-014 | — |
| GET | `/v1/admin/users-list` | JWT (Admin) | query `searchValue?`, `city?` (unused), `skip?`, `limit?` | `{ usersList, maxPages }` (`maxPages` min 1) | — | TASK-014 | — |
| GET | `/v1/admin/campaigns-list` | JWT (Admin) | query `skip?`, `limit?` (+ `searchValue` read from same query type) | Campaigns list with regex search | — | TASK-014 | — |
| PUT | `/v1/admin/update-user/:userId` | JWT (Admin) | param `userId`; body `UpdateUserAdminDto`: `{ email?, phone?, role?, status? }` | Updated user | Validation 400s | TASK-014 | — |
| POST | `/v1/admin/send-notification/:userId` | JWT (Admin) | param `userId`; body `{ title, message }` | Result of persisted + emitted `System` notification | — | TASK-014 (delivery: TASK-015) | — |
| GET | `/v1/admin/backend-logs` | JWT (Admin) | query `onlyRequests?` (`'true'\|'false'`), `level` (pino numeric level) | Array of parsed log lines (matching level) sorted by `time` desc | **On FS error nothing is sent — the request hangs** (error only logged) | TASK-014 | D6 (no error response; see D6-03; ops-review flag below) |

## Row-count cross-check (AC-01)

| Controller | Routes |
| --- | --- |
| `v1.controller.ts` | 9 |
| `v1/auth/v1.auth.controller.ts` | 8 |
| `v1-users.controller.ts` | 9 |
| `v1-campaigns.controller.ts` | 8 |
| `v1-campaigns-admin.controller.ts` | 11 |
| `v1-campaigns-vip.controller.ts` | 1 |
| `v1-services.controller.ts` | 1 |
| `v1-workers.controller.ts` | 2 |
| `v1-schedule.controller.ts` | 2 |
| `v1-appointments.controller.ts` | 2 |
| `v1-comments.controller.ts` | 4 |
| `v1-admin.controller.ts` | 10 |
| **Total** | **67** |

## Ownership notes

- `GET /v1/city/:limit` and `GET /v1/user-city` are owned by **TASK-005** (cities domain); the TASK-019 spec covers only status/exchange/aggregate-search.
- `POST /v1/push-subscribe` / `DELETE /v1/push-unsubscribe` are declared in `v1.controller.ts` next to TASK-019 utility routes but are owned by **TASK-016** (Web Push) — TASK-019 explicitly excludes them.
- `POST /v1/feedback` is owned by **TASK-017**; the admin feedback HTTP routes are owned by **TASK-014** with TASK-017 owning domain/persistence (per both specs).
- Campaign worker attach/detach (`POST|DELETE /v1/campaigns/:id/worker/:workerId`) go to **TASK-008** per the TASK-007 spec ("prefer TASK-008 for worker mutate").
- `GET /v1/services/profitable` is grouped with campaigns core (**TASK-007**) — it lists campaign services; no dedicated services task exists.

## Ops-review flags (spec: Observability and operations)

- `GET /v1/admin/backend-logs` reads pino log files from the API container filesystem — production risk; TASK-014 must document/harden (D6 hardening without feature removal).
- Ranking cron jobs (see [`SIDE_EFFECTS.md`](SIDE_EFFECTS.md)) run heavy unbounded `Promise.all` scans in-process — TASK-013 must move them to Cron→Worker under distributed locks.
