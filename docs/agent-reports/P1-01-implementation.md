# P1-01 — Implementation report

## Verdict

implemented

## Approved plan

`docs/agent-plans/P1-01-local-storage-path-traversal.md` (`status: approved`)

## Changed files

| Path                                                            | Change                                                                                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/storage/local-storage.adapter.ts`      | Cached resolved storage root; hardened `path()` with validation and containment checks; fixed `getSignedUrl` signature; removed absolute filesystem paths from public return values |
| `libs/infrastructure/src/storage/local-storage.adapter.spec.ts` | **Created** — valid nested key CRUD; V-03 negative traversal matrix; containment proofs                                                                                             |
| `README.md`                                                     | One-line note in §5.10: local driver returns storage key references, not filesystem paths                                                                                           |

## Follow-up completion (2026-06-21)

| Path                                                            | Change                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/storage/local-storage.adapter.ts`      | Reject keys resolving exactly to storage root (`rel === ''`), aligned with backlog example code |
| `libs/infrastructure/src/storage/local-storage.adapter.spec.ts` | Added `.` to V-03 negative matrix                                                               |

## Completed steps

1. Cached `storageRoot` via `resolve(config.storage().localPath)` in the constructor.
2. Hardened `path(key)` — reject empty/whitespace, null bytes, absolute keys; normalize `\` to `/`; resolve candidate; validate with `relative()` containment including `rel === ''`.
3. Updated URL behavior per plan default (no approved public base URL): `putObject` returns `{ key }` only; `getSignedUrl(key, _expiresInSeconds)` returns the storage key.
4. Added `local-storage.adapter.spec.ts` with V-03 negative matrix and containment checks.
5. Added minimal README §5.10 documentation for local URL behavior.

## Deviations

None from the approved plan.

**Open questions resolved at implementation time (plan defaults):**

| Question                       | Decision                                                  |
| ------------------------------ | --------------------------------------------------------- |
| Local public URL shape         | Storage key only; `putObject.url` omitted                 |
| `getSignedUrl` local semantics | `expiresInSeconds` ignored; returns validated storage key |
| Error type                     | Generic `Error` with stable messages                      |
| README update                  | One-line note added                                       |
| Empty key policy               | Rejected                                                  |
| Root path key (`rel === ''`)   | Rejected (backlog example alignment)                      |

## Commands executed

```bash
npm ci
npm run test:unit -- libs/infrastructure/src/storage/local-storage.adapter.spec.ts
npm run build
npm run lint
npm run test:unit
```

## Command results

| Command                                               | Result                    | Conclusion                                           |
| ----------------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| Targeted unit tests (`local-storage.adapter.spec.ts`) | Exit 0 — 13 tests passed  | V-03 matrix (incl. `.`) and valid-key CRUD confirmed |
| `npm run build`                                       | Exit 0                    | Contract compliance confirmed                        |
| `npm run lint`                                        | Exit 0                    | Full lint gate passes                                |
| `npm run test:unit`                                   | Exit 0 — 118 tests passed | Full unit suite green                                |

## Acceptance criteria self-check

| #   | Criterion                                                                        | Status |
| --- | -------------------------------------------------------------------------------- | ------ |
| 1   | Traversal, absolute, empty, and null-byte keys rejected before filesystem access | Pass   |
| 2   | Nested key `users/123/avatar.png` supports write/read/delete                     | Pass   |
| 3   | Filesystem operations confined to resolved root                                  | Pass   |
| 4   | `getSignedUrl(key, expiresInSeconds)` implements contract                        | Pass   |
| 5   | Public URL fields do not expose raw absolute filesystem paths                    | Pass   |
| 6   | `npm run lint`, `npm run build`, targeted unit tests pass                        | Pass   |
| 7   | V-03 negative matrix in `local-storage.adapter.spec.ts`                          | Pass   |

## Remaining risks

- Symlink escape under storage root remains out of scope (documented in plan).

## Unverified areas

- No integration test with HTTP download endpoint (out of scope per plan).
- Symlink-based escape not tested (explicitly out of scope).
