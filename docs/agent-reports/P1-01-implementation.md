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

## Completed steps

1. Cached `storageRoot` via `resolve(config.storage().localPath)` in the constructor.
2. Hardened `path(key)` — reject empty/whitespace, null bytes, absolute keys; normalize `\` to `/`; resolve candidate; validate with `relative()` containment.
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

## Commands executed

```bash
npm install
npm run test:unit -- libs/infrastructure/src/storage/local-storage.adapter.spec.ts
npm run build
npm run lint
npm run test:unit
```

## Command results

| Command                                               | Result                       | Conclusion                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                         | Exit 0                       | Required locally — `node_modules` was incomplete (`jest`, `@nestjs/common` missing)                                                         |
| Targeted unit tests (`local-storage.adapter.spec.ts`) | Exit 0 — 12 tests passed     | V-03 matrix and valid-key CRUD confirmed                                                                                                    |
| `npm run build`                                       | Exit 0                       | `IStorageGateway` compliance confirmed after `getSignedUrl` signature fix                                                                   |
| `npm run lint`                                        | Exit 1                       | Pre-existing failures in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` (unused vars); **not introduced by P1-01** |
| `npm run test:unit`                                   | Exit 1 — 32 passed, 1 failed | Failure in `outbox-processor.options.schema.spec.ts` (pre-existing); all 12 `LocalStorageAdapter` tests passed                              |

## Acceptance criteria self-check

| #   | Criterion                                                                        | Status                                                                                          |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Traversal, absolute, empty, and null-byte keys rejected before filesystem access | Pass — unit matrix covers `../`, `..\\`, POSIX/Windows absolutes, nested traversal, empty, `\0` |
| 2   | Nested key `users/123/avatar.png` supports write/read/delete                     | Pass                                                                                            |
| 3   | Filesystem operations confined to resolved root                                  | Pass — containment tests + `relative()` guard in adapter                                        |
| 4   | `getSignedUrl(key, expiresInSeconds)` implements contract                        | Pass — build succeeds                                                                           |
| 5   | Public URL fields do not expose raw absolute filesystem paths                    | Pass — `putObject` omits `url`; `getSignedUrl` returns key                                      |
| 6   | `npm run lint`, `npm run build`, targeted unit tests pass                        | Partial — build and targeted tests pass; full lint blocked by pre-existing outbox issues        |
| 7   | V-03 negative matrix in `local-storage.adapter.spec.ts`                          | Pass — 8 malicious keys × 4 operations + containment proofs                                     |

## Remaining risks

- Symlink escape under storage root remains out of scope (documented in plan).
- `getObject` / `deleteObject` throw synchronously on invalid keys (same as before for I/O errors propagated from sync `path()` call); callers using bare `.rejects` without async wrapper may not catch validation errors — behavior unchanged from typical sync-throw pattern.

## Unverified areas

- Full `npm run lint` and full `npm run test:unit` suite not green due to pre-existing outbox failures unrelated to this change.
- No integration test with real HTTP download endpoint (out of scope).
- Independent verification not yet performed.
