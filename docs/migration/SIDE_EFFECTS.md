# Non-HTTP side-effect contracts (FR-02, FR-03)

Inventory of legacy Socket.IO, cron, Web Push, mail, S3 and Fondy behavior that later tasks turn into starter Outbox/Worker/Cron equivalents.

## 1. Socket.IO notifications gateway — owner: TASK-015

Source: `OLD_BACKEND/src/v1/sockets/notifications.gateway.ts` (+ `notifications.service.ts`).

Gateway config: default namespace/port (attached to the API HTTP server), CORS restricted to `FRONTEND_URL` / `FRONTEND_DOMAIN` with `credentials: true`.

### Handshake auth (FR-02)

Access token resolved in this order (first non-empty wins):

1. `handshake.auth.token` (optional `Bearer ` prefix stripped);
2. `Authorization` header (optional `Bearer ` prefix stripped);
3. `auth-cookie` cookie from the handshake cookie header.

Token verified with `jsonwebtoken.verify(token, ACCESS_TOKEN_SECRET)`; payload must contain `id`. Unauthorized connections are disconnected immediately. The gateway keeps at most **5 concurrent socket ids per user** (oldest evicted).

### Client → server events (`@SubscribeMessage`)

| Event | Payload | Behavior |
| --- | --- | --- |
| `notifications` | `[limit, skip, isNewArray]` | Loads user notifications, emits `notifications` back to all of the user's sockets |
| `new-notifications` | `[limit, skip, isNewArray]` | Loads only unread notifications, emits `new-notifications` back |
| `read` | `notificationId` | Marks one notification read; returns `true` (ack) |
| `read-all` | — | Marks all read; emits `read-all` (payload `true`) to the user's sockets |
| `remove-notification` | `notificationId` | Deletes the notification (ack) |
| `count-new-notification` | — | Emits `count-new-notification` with the unread count |

### Server → client events

| Event | Payload | Trigger |
| --- | --- | --- |
| `notifications` | `(Notification[], isNewArray)` | Response to `notifications` |
| `new-notifications` | `(Notification[], isNewArray)` | Response to `new-notifications` |
| `read-all` | `true` | Response to `read-all` |
| `count-new-notification` | `number` | Response to `count-new-notification` |
| `new-notification` | populated `Notification` | Pushed whenever `NotificationsService.emitNewNotification` runs (see call sites below) |

### `emitNewNotification` call sites (persist + realtime emit)

| Caller | Trigger | Notification type |
| --- | --- | --- |
| `v1.controller.ts` `POST /v1/feedback` | Feedback received (only if authenticated — never true in OLD, no guard) | `System` |
| `admins.service.ts::sendNotification` (via `POST /v1/admin/send-notification/:userId`) | Admin message | `System` |
| `v1-campaigns-admin.controller.ts` `POST /:campaignId/privileges/:userId` | Privileges changed | `Campaign` |
| `v1-schedule.controller.ts` `POST /v1/schedule/:campaignId` | Schedule exclusion added for another master | `Campaign` |

Note: appointment-related notifications, if any, live in `appointments.service.ts` internals — TASK-011/TASK-015 implementers should re-check when transcribing those flows.

## 2. Cron jobs (FR-03)

| # | Source | Method | Schedule | What it does | TASK owner |
| --- | --- | --- | --- | --- | --- |
| 1 | `services/ranking-system.service.ts` | `calculateRatingOfCompanies` | `CronExpression.EVERY_12_HOURS` | Recomputes `companyRankingSystem` + average `rating` for all active campaigns (appointments last 90 days ×3 + positive review ratings ×5) | TASK-013 |
| 2 | `services/ranking-system.service.ts` | `calculateRatingOfWorkers` | `CronExpression.EVERY_WEEK` | Recomputes `workerRankingSystem` for all masters (same weights) | TASK-013 |
| 3 | `services/ranking-system.service.ts` | `calculateRatingOfServices` | `CronExpression.EVERY_WEEK` | Recomputes `serviceRankingSystem` for all services (same weights) | TASK-013 |
| 4 | `services/admins.service.ts` | `clearOldLogs` | `CronExpression.EVERY_WEEK` | Deletes pino log files older than 30 days from the `logs/` directory | TASK-014 |

All four run in the OLD API process via `@nestjs/schedule` with no distributed lock — in the starter they belong to the Cron entrypoint (enqueue under lock) + Worker execution. Ops-review flag: the ranking jobs do unbounded `Promise.all` over all campaigns/workers/services.

## 3. Web Push (FR-03) — owner: TASK-016

- Bootstrap: `OLD_BACKEND/src/main.ts` calls `setupWebpush(logger)` (`configs/webpush.ts`) — `webpush.setVapidDetails('mailto:admin@levych.com', PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY)`. Both env vars are required by `env.validation.ts`.
- Subscription storage: `v1/pushMessages/push-messages.service.ts` persists Web Push subscriptions to the `push-subscribes` table and mirrors the ids in `users.pushSubscribesIds` (JSONB).
- Entry points:
  - `POST /v1/push-subscribe` — stores subscription, links to user, immediately sends a hard-coded greeting push (`Hey, bruh!` / `Добрий день, everybody.`);
  - `DELETE /v1/push-unsubscribe` — removes subscription by `endpoint` and unlinks from the user;
  - `sendPushMessageUser(userId, message)` — sends to all of a user's subscriptions via `webpush.sendNotification`, default icon `FRONTEND_URL + '/public/images/withTextRight.png'`, failures tolerated (`Promise.allSettled`).
- No other production caller of `sendPushMessageUser` exists beyond the subscribe greeting — admin/system pushes are a TASK-016 design decision, not legacy parity.

## 4. Mail triggers (FR-03)

Source: `OLD_BACKEND/src/mail/mail.service.ts` (`@nestjs-modules/mailer`, Handlebars templates).

| Mail method | Template | Caller | Route that triggers it | TASK owner |
| --- | --- | --- | --- | --- |
| `sendConfirmationResetPassword(to, userName, token)` | `./password/reset-password` | `user.service.ts::restoreUserPassword` | `POST /v1/users/restore-password` | TASK-004 |
| `sendSuccessResetPassword(to, userName)` | `./password/password-success-changed` | `user.service.ts::restorePasswordSuccessMessage` | `POST /v1/users/restore-password/setup` | TASK-004 |
| `sendAppointmentToMaster(to, userName, dateApp)` | `./appointments/appointments-record-master` | `appointments.service.ts` (createAppointments flow) | `POST /v1/appointments/` | TASK-011 |

Starter target: mail dispatch goes through the existing Mail/Outbox pattern (side effects via Outbox → Worker), not inline awaits in request handlers.

## 5. S3 upload call sites (FR-03) — wiring owner: TASK-006 (+ feature owners)

Source: `OLD_BACKEND/src/services/aws-s3.service.ts` (`@aws-sdk/client-s3`; bucket `AWS_S3_BUCKET`; random 30-char key + unix timestamp; public URL string returned).

| Call site | Methods used | Feature | TASK owner |
| --- | --- | --- | --- |
| `v1-campaigns.controller.ts` `POST /v1/campaigns/` | `uploadBase64ImageWithReturnLocation` (campaign photo + previews + service previews), `uploadBase64Image` (QR code) | Campaign creation media | TASK-006 + TASK-007 |
| `v1-users.controller.ts` `POST /v1/users/update-user` | `deleteFromS3` (old photo), `uploadBase64Image` (new photo) | User avatar | TASK-006 + TASK-004 |
| `repositories/campaigns.repository.ts` (campaign update path) | `uploadBase64Image` (photo, previews on update) | Campaign media update | TASK-006 + TASK-008 |
| `services/campaigns/campaigns.service.ts` | `S3Service` injected; no direct call in service body (delegates to repository) | — | TASK-006 (audit during TASK-007/008) |

`deleteFromS3` swallows errors (logs only). `uploadFile(Express.Multer.File)` exists but has no HTTP consumer in `v1` controllers.

## 6. Fondy payments (D5 as-is) — owner: TASK-018

- Source: `OLD_BACKEND/src/services/payments/payments.service.ts` (`cloudipsp-node-js-sdk`, `PAYMENT_MERCHANT_ID` / `PAYMENT_SECRET_KEY`).
- **Registration is commented out** in `OLD_BACKEND/src/app.module.ts` (import at line 22 and provider at line 126 are both commented) — the service never runs in OLD.
- It exposes **no HTTP routes**; the only behavior is an `onApplicationBootstrap` test `Checkout`/`Status` call with hard-coded demo data.
- TASK-018 migrates it as-is (disabled/unwired) and documents that state; no parity rows exist in the HTTP matrix.
