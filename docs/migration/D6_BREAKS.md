# D6 intentional breaks (AC-03 / FR-05)

Explicit list of legacy security/correctness defects that are **fixed during migration** per locked decision **D6** (`docs/agent-tasks/MIGRATION_PROGRAM.md`).

> **These behaviors are NOT preserved as parity contracts.** Any `HTTP_PARITY_MATRIX.md` row carrying a D6 flag must implement the *target behavior* below, not the legacy behavior. Everything else in the matrix remains "same as OLD".

## D6-01 — Password hash leaks / missing response sanitization

**Legacy behavior:** identity endpoints return raw `User` entities. Where the user is loaded with `getUserWithPassword`, the bcrypt hash is serialized into the response; even "sanitized" routes only manually strip `password` and nothing else.

**Affected matrix rows:**

| Route | Leak |
| --- | --- |
| `POST /v1/auth/login` | Returns validated user **including bcrypt `password` hash** |
| `POST /v1/auth/login/admin` | Returns admin user **including bcrypt `password` hash** |
| `POST /v1/auth/reg` | Returns created user unsanitized |
| `GET /v1/auth/google/redirect` | Spreads the whole validated user (plus `POPUP_SECRET_KEY`) into a `postMessage` HTML payload |
| `GET /v1/profile` | Only `password` is manually set `undefined`; no systematic sanitization (e.g. `latestLogins` session data is exposed) |
| `POST /v1/users/restore-password/check` | Returns the matched user/restore record to an unauthenticated caller holding only the emailed signature |
| `GET /v1/workers/:id` | Public route returns the full `User` entity (email, phone, settings, session metadata) |

**Target behavior:** every identity response goes through an explicit presenter/DTO with an allowlist of public fields; `password`, tokens, restore codes and session metadata are never serialized. Response *shape* (top-level user fields the FE actually consumes) stays matrix-compatible minus the secret fields.

**Owners:** TASK-003 (auth routes), TASK-004 (profile/users/restore), TASK-009 (public worker profile).

## D6-02 — Comment author spoofing via request body `from`

**Legacy behavior:** `POST /v1/comments/` accepts `CommentItem.from` (author user id) directly from the client body and persists it. Any caller can create a comment attributed to any user; the route is even reachable with `@Auth(UserRole.All)` (optional token).

**Affected matrix rows:** `POST /v1/comments/` (section 11).

**Target behavior:** the author is taken exclusively from the authenticated JWT (`req.user.userId`); body `from` is ignored/rejected. Whether anonymous (unauthenticated) commenting remains allowed is a TASK-012 decision to record in that task's plan — but client-chosen authorship is never honored.

**Owner:** TASK-012.

## D6-03 — Error-as-200 responses and swallowed errors

**Legacy behavior:** several handlers wrap the body in `try/catch` and `return error` (serialized `Error` object with HTTP 200), or log the error and return nothing (200 empty body / hung response).

**Affected matrix rows:**

| Route | Legacy failure mode |
| --- | --- |
| `POST /v1/campaigns/` | `catch` returns the `Error` object with status 200 (campaign may be partially created — no transaction) |
| `GET /v1/comments/:itemId` | `catch` returns the `Error` object with status 200 |
| `GET /v1/comments/can-do/:itemId` | `catch` returns the `Error` object with status 200 |
| `GET /v1/utils/aggregate-search` | Missing `city` or any thrown error → 200 with empty body (error only logged) |
| `GET /v1/admin/backend-logs` | On filesystem error nothing is sent — the HTTP request hangs until client timeout |
| `POST /v1/appointments/` | Audit during TASK-011: service-level failures must surface as proper errors, not partial 200s (mail side effect is fire-and-forget in OLD) |

**Target behavior:** failures map to proper non-200 error envelopes through the starter's exception mapping (validation → 400, not-found → 404, upstream unavailability → 502/503, unexpected → 500). No route returns a serialized `Error` with status 200 and no route hangs without a response. `TASK-019 NFR-01` additionally requires PrivatBank upstream failures to be proper errors (legacy already throws 503 there; the D6 fix applies to aggregate-search).

**Owners:** TASK-007 (campaigns create), TASK-011 (appointments), TASK-012 (comments), TASK-014 (backend-logs), TASK-019 (aggregate-search).

## Related non-break notes

- `DELETE /v1/push-unsubscribe` crashes with an unhandled `TypeError` (500) for unknown endpoints — a plain bug, not a contract; TASK-016 should return a proper 404/400. Recorded here for visibility; it is not a "parity" behavior anyone should reproduce.
- Feedback persistence being commented out (`POST /v1/feedback`) is a **D5 as-is quirk**, not a D6 break — the enable/keep-disabled decision is an open human question in TASK-017.
