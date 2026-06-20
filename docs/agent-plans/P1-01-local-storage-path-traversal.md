---
issue_id: P1-01
status: approved
owner: human-approval-required
---

# P1-01 — Close path traversal in LocalStorageAdapter

## Source issue

`docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` — section **P1-01. Закрити path traversal у `LocalStorageAdapter`**.

Related verification scenario: backlog **V-03** (LocalStorage traversal negative matrix).

## Current behavior

1. `LocalStorageAdapter.path(key)` resolves object keys with `join(this.config.storage().localPath, key)` and no validation.
2. All filesystem operations (`putObject`, `getObject`, `deleteObject`, `getSignedUrl`) delegate to `path(key)`.
3. Keys such as `../outside.txt`, absolute paths (`/tmp/x`, `C:\x`), backslash traversal (`..\\x`), or null bytes can resolve outside `LOCAL_STORAGE_PATH`.
4. `putObject` returns `{ key, url: path }` where `url` is the absolute filesystem path.
5. `getSignedUrl` returns the absolute filesystem path via `this.path(key)`.
6. `getSignedUrl` is declared as `(key: string)` only; `IStorageGateway` requires `(key: string, expiresInSeconds: number)` — contract mismatch on the local adapter.
7. No unit or integration tests exist for `LocalStorageAdapter` (no `*storage*.spec.ts` files).
8. No Application or API-layer consumers inject `TOKENS.StorageGateway` yet; the adapter is registered and exported through infrastructure DI only.

**Investigation (2026-06-20, current branch):** defect confirmed — `local-storage.adapter.ts` lines 36–38 still use naive `join` without containment checks. Issue is **not stale**.

## Confirmed root cause

`LocalStorageAdapter.path()` trusts caller-supplied `key` as a relative path segment. Node `path.join` / `path.resolve` semantics allow traversal (`..`), absolute paths, and platform-specific separators to escape the configured storage root before `readFile`, `writeFile`, or `rm` execute with process filesystem privileges.

## Dependency/runtime flow

```text
Future controller / use case
  -> @Inject(TOKENS.StorageGateway) IStorageGateway
       -> StorageModule factory (driver === 's3' ? S3StorageAdapter : LocalStorageAdapter)
            -> LocalStorageAdapter.path(untrustedKey)
                 -> join(configuredRoot, key)   // no containment check
                   -> fs mkdir / writeFile / readFile / rm outside root
```

**DI registration:**

```text
InfrastructureModule
  -> StorageModule
       providers: LocalStorageAdapter, S3StorageAdapter, TOKENS.StorageGateway factory
       exports: TOKENS.StorageGateway
```

**Config source:**

```text
env LOCAL_STORAGE_PATH
  -> env.schema.ts
    -> InfrastructureConfigModule
      -> AppConfigService.storage().localPath
        -> LocalStorageAdapter
```

## Goal

Ensure every `LocalStorageAdapter` filesystem operation is confined to the resolved absolute storage root, reject traversal and invalid keys early, and add a negative test matrix aligned with **V-03**. Align local adapter public URL behavior with the storage gateway contract where feasible without expanding into unrelated portability work.

## Scope

1. Harden `LocalStorageAdapter.path()` (or equivalent private resolver) with root resolution, key normalization, invalid-key rejection, and post-resolve containment validation.
2. Resolve and cache the absolute storage root once per adapter instance.
3. Add unit tests covering valid nested keys and a negative traversal matrix (POSIX and Windows-style separators).
4. Fix `getSignedUrl` signature to satisfy `IStorageGateway`.
5. Stop returning raw absolute filesystem paths from public-facing URL fields where the fix scope allows a contract-safe alternative (see open questions).

## Out of scope

- P2-03 / `StorageModule.forRootAsync` portability refactor (backlog mentions future dynamic module pattern; not required for this security fix).
- S3 adapter key validation (S3 keys are object keys, not filesystem paths; different threat model).
- Application-layer input validation for object keys (defense-in-depth belongs in use cases, but this fix secures the adapter boundary).
- New env vars unless human approves a public base URL (see open questions).
- HTTP static file serving or download endpoint implementation.
- Changes to `IStorageGateway` method signatures beyond local adapter compliance.
- `StorageModule`, `InfrastructureModule`, or composition root changes (no DI updates expected).
- Integration tests requiring PostgreSQL, Redis, or S3.

## Files to create

| Path                                                            | Responsibility                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/storage/local-storage.adapter.spec.ts` | Unit tests: valid nested keys; negative traversal matrix (**V-03**); optional filesystem containment checks using a temp directory. |

## Files to modify

| Path                                                       | Symbol / responsibility                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/storage/local-storage.adapter.ts` | `LocalStorageAdapter` — cache resolved root; harden `path()` with `resolve`/`relative` containment; reject empty, absolute, null-byte, and traversal keys; update `getSignedUrl` signature; adjust `putObject` / `getSignedUrl` return values per approved URL policy. |

## Files to delete

None.

## Contract and DI changes

### `IStorageGateway` (unchanged)

```ts
// libs/contracts/src/storage/storage-gateway.ts
putObject(...): Promise<{ key: string; url?: string }>;
getObject(key: string): Promise<Buffer>;
deleteObject(key: string): Promise<void>;
getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
```

No token or interface changes. `TOKENS.StorageGateway` registration in `storage.module.ts` stays the same.

### Local adapter compliance fix

`LocalStorageAdapter.getSignedUrl` must accept `expiresInSeconds: number` to implement `IStorageGateway`. For the local driver, `expiresInSeconds` may be ignored (no presign semantics), but the parameter must exist.

### Error surface

Backlog example throws generic `Error` with stable messages (`Invalid storage key`, `Storage key escapes configured root`). No new contract types required unless human prefers a shared infrastructure error class (open question).

## Implementation steps

1. **Cache resolved storage root**
   - In `LocalStorageAdapter`, resolve `this.config.storage().localPath` to an absolute path once (constructor private field or lazy getter).
   - Use `resolve()` so relative config values like `./storage` are anchored consistently.

2. **Harden key resolution in `path(key)`**
   - Import `isAbsolute`, `relative`, `resolve`, `sep` from `node:path`.
   - Reject before filesystem access when:
     - key is empty/whitespace-only;
     - key contains `\0`;
     - key is absolute (`isAbsolute(key)`).
   - Normalize platform separators: `key.replaceAll('\\', '/')` before joining (backlog pattern).
   - Compute `candidate = resolve(root, normalizedKey)`.
   - Compute `rel = relative(root, candidate)`.
   - Reject when `rel === '..'`, `rel.startsWith('..' + sep)`, or `isAbsolute(rel)`.
   - Return `candidate` on success.

3. **Align URL return behavior**
   - After `path()` is safe, decide approved public URL shape (see open questions).
   - Minimum safe default if no base URL is approved: omit filesystem paths from outward responses — e.g. `putObject` returns `{ key: input.key }` without `url`, and `getSignedUrl` returns the storage key or a relative key path rather than an absolute filesystem path.
   - Implement `getSignedUrl(key, _expiresInSeconds)` with contract-correct signature.

4. **Add unit tests (`local-storage.adapter.spec.ts`)**
   - Instantiate adapter with mocked `AppConfigService` pointing `localPath` at a temp directory (`mkdtemp`).
   - **Valid cases:**
     - `users/123/avatar.png` write/read/delete succeed under root.
   - **Negative matrix (V-03):** each throws before escaping root:
     - `../outside.txt`
     - `..\\outside.txt`
     - `/tmp/outside.txt` (POSIX absolute)
     - `C:\\outside.txt` (Windows-style absolute; test runs on all platforms — at least one absolute form must be rejected per platform, both forms covered in matrix)
     - `users/../../outside.txt`
     - `users/../..`
     - empty string `''`
     - key containing `\0`
   - **Containment proof (recommended):** for a rejected key, assert no file appears outside temp root; for a valid key, assert resolved file path stays under root.

5. **Documentation touch (minimal, only if URL behavior changes)**
   - If public URL return shape changes, add a one-line note to README §5.10 that local driver returns key-based references, not filesystem paths. Skip if human defers doc update.

## Migration and rollout concerns

- **No DB migration.**
- **No env migration** unless human approves a public base URL variable.
- **Behavior change:** previously accepted malicious keys will now throw; legitimate nested relative keys continue to work.
- **Breaking for misuse only:** any caller relying on traversal or absolute paths will fail fast (intended).
- **Default driver:** `STORAGE_DRIVER=local` — fix applies to default local development deployments.

## Targeted verification

During implementation:

```bash
npm run test:unit -- libs/infrastructure/src/storage/local-storage.adapter.spec.ts
npm run build
```

`npm run build` validates `IStorageGateway` compliance after `getSignedUrl` signature fix. Infrastructure/shared contract touched indirectly via adapter implementing contract.

## Full verification

Before marking implementation complete:

```bash
npm run build
npm run lint
npm run test:unit
```

Shared infrastructure adapter and security boundary change → full `npm run build` required per project rules.

**V-03 verification report (post-implementation, separate from unit test file):**

| Field            | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Issue ID         | V-03                                                                                                             |
| Command/scenario | `npm run test:unit -- libs/infrastructure/src/storage/local-storage.adapter.spec.ts` — negative traversal matrix |
| Expected result  | All traversal/absolute/empty/null-byte keys rejected; nested valid key succeeds; no writes outside temp root     |
| Evidence         | Jest output + test names documenting matrix                                                                      |

Note: backlog **V-03** is specifically the LocalStorage traversal matrix. It is unrelated to `apps/worker/src/processors/email.processor.int-spec.ts` (Redis idempotency), despite that file's outdated `V-03` describe label.

## Acceptance criteria

1. Keys `../x`, `..\\x`, POSIX absolute paths, Windows-style absolute paths, encoded/normalized traversal variants, empty keys, and null-byte keys are rejected before filesystem access.
2. Nested key `users/123/avatar.png` supports write/read/delete within the configured root.
3. Filesystem operations cannot read, write, or delete outside the resolved `LOCAL_STORAGE_PATH` root.
4. `LocalStorageAdapter` implements `IStorageGateway.getSignedUrl(key, expiresInSeconds)` without type errors.
5. Public URL fields do not expose raw absolute filesystem paths (per approved URL policy).
6. `npm run lint`, `npm run build`, and targeted unit tests pass.
7. **V-03** negative matrix is covered by `local-storage.adapter.spec.ts`.

## Risks

| Risk                                                          | Mitigation                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Platform path differences on Windows vs POSIX                 | Use `resolve` + `relative` containment check; test both `/` and `\\` traversal forms.              |
| Symlink escape under storage root                             | Out of scope for this issue; document as residual risk if root contains symlinks pointing outside. |
| Breaking callers expecting `putObject.url` as filesystem path | Intended security improvement; document in README if shape changes.                                |
| Overly strict rejection of valid keys                         | Allow normal nested relative keys; only reject absolute, empty, null byte, and `..` escape.        |
| `LOCAL_STORAGE_PATH` itself contains `..`                     | Resolve root once with `resolve()`; containment relative to resolved root still holds.             |

## Rollback strategy

Revert the commit. Adapter returns to naive `join` behavior (re-opens vulnerability). No migration rollback needed.

## Open questions requiring human decision

1. **Local public URL shape:** Should `putObject.url` and `getSignedUrl` return (a) the storage key only, (b) a relative path like `storage/{key}`, or (c) a configurable HTTP base URL via a new env var (e.g. `LOCAL_STORAGE_PUBLIC_BASE_URL`)? Backlog item 5 forbids raw filesystem paths but does not prescribe the replacement.
2. **`getSignedUrl` semantics for local driver:** Is ignoring `expiresInSeconds` acceptable (return static key/URL reference), or should local mode throw `not supported`?
3. **Error type:** Keep generic `Error` messages per backlog example, or introduce a shared validation error type mappable to HTTP 400 by the exception layer?
4. **README update:** Minimal note in §5.10 when URL behavior changes, or defer documentation to a separate docs task?
5. **Empty key policy:** Backlog rejects empty key — confirm no legitimate use case for writing to storage root with `key: ''`.
