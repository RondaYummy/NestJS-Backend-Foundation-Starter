# P1-01 — Independent verification

## Verdict

**approved**

## Scope checked

**In scope (per approved plan):**

| Path                                                            | Status                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `libs/infrastructure/src/storage/local-storage.adapter.ts`      | Modified — root caching, hardened `path()`, contract-compliant `getSignedUrl`, key-only public URLs |
| `libs/infrastructure/src/storage/local-storage.adapter.spec.ts` | Created — valid CRUD, V-03 negative matrix, containment proofs                                      |
| `README.md` §5.10                                               | One-line note on local driver URL behavior                                                          |

**Out of plan but present in working tree:**

- `docs/agent-backlog/INDEX.md` and `docs/agent-backlog/NESTJS_STARTER_KIT_REQUIRED_FIXES.md` contain large backlog resynchronization edits unrelated to P1-01. These are not listed in the implementation report and are outside the approved plan scope. They do not affect the security fix.

**Not changed (as planned):** `StorageModule`, `InfrastructureModule`, `IStorageGateway`, S3 adapter, composition roots.

## Root-cause assessment

**Confirmed root cause:** `LocalStorageAdapter.path()` previously used naive `join(localPath, key)` with no validation, allowing traversal, absolute paths, and platform-specific separators to escape `LOCAL_STORAGE_PATH`.

**Fix assessment:** The implementation addresses the root cause directly:

1. Resolves and caches `storageRoot` once via `resolve(config.storage().localPath)` in the constructor.
2. Rejects empty/whitespace, null-byte, and absolute keys before any filesystem access.
3. Normalizes backslashes to forward slashes before joining.
4. Validates containment with `relative(storageRoot, candidate)` and rejects escape patterns.
5. All four public methods (`putObject`, `getObject`, `deleteObject`, `getSignedUrl`) route through the hardened `path()` resolver.

This is a boundary-level fix at the adapter, not a symptom suppressor.

## Acceptance criteria matrix

| #   | Criterion                                                                        | Result                   | Evidence                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Traversal, absolute, empty, and null-byte keys rejected before filesystem access | **passed**               | 8 malicious keys × 4 operations in `it.each`; sync validation in `path()` before `fs` calls                                                                         |
| 2   | Nested key `users/123/avatar.png` supports write/read/delete                     | **passed**               | Valid-keys describe block; 12/12 targeted tests green                                                                                                               |
| 3   | Filesystem operations confined to resolved root                                  | **passed**               | `relative()` containment guard + containment proof tests (no files outside temp root; valid keys under root only)                                                   |
| 4   | `getSignedUrl(key, expiresInSeconds)` implements `IStorageGateway`               | **passed**               | Signature matches contract; `npm run build` exit 0                                                                                                                  |
| 5   | Public URL fields do not expose raw absolute filesystem paths                    | **passed**               | `putObject` returns `{ key }` only (`url` undefined); `getSignedUrl` returns storage key                                                                            |
| 6   | `npm run lint`, `npm run build`, targeted unit tests pass                        | **passed** (P1-01 scope) | Build exit 0; targeted spec 12/12 pass; P1-01 files lint clean. Full-project `npm run lint` fails on pre-existing outbox unused-var errors unrelated to this change |
| 7   | V-03 negative matrix covered by spec file                                        | **passed**               | `describe('V-03 negative traversal matrix')` with full matrix                                                                                                       |

## Dependency and DI verification

```text
IStorageGateway (unchanged)
  -> TOKENS.StorageGateway factory in StorageModule (unchanged)
       -> LocalStorageAdapter (hardened)
            -> AppConfigService.storage().localPath -> resolve() -> storageRoot
```

- No token, interface, or module registration changes required or made.
- `LocalStorageAdapter` still implements `IStorageGateway` without type errors (confirmed by build).
- No Application or API consumers of `TOKENS.StorageGateway` exist yet; adapter boundary is the correct fix point.

## Commands executed

| Command                                                                                                                                              | Result                                                                                       | Conclusion                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run test:unit -- libs/infrastructure/src/storage/local-storage.adapter.spec.ts`                                                                 | Exit 0 — 12 passed                                                                           | V-03 matrix and valid-key CRUD confirmed at runtime                  |
| `npm run build`                                                                                                                                      | Exit 0                                                                                       | Contract compliance and compilation confirmed across all entrypoints |
| `npx eslint libs/infrastructure/src/storage/local-storage.adapter.ts libs/infrastructure/src/storage/local-storage.adapter.spec.ts --max-warnings=0` | Exit 0                                                                                       | P1-01 changed files lint clean                                       |
| `npm run lint`                                                                                                                                       | Exit 1 — 4 errors in `outbox-processor.defaults.ts` and `outbox-processor.options.schema.ts` | Pre-existing; no P1-01 files involved                                |
| `npm run test:unit`                                                                                                                                  | Exit 1 — 32 passed, 1 failed (`outbox-processor.options.schema.spec.ts`)                     | Pre-existing outbox failure; all 12 LocalStorageAdapter tests passed |

## Findings

1. **Implementation matches approved plan.** All planned steps completed; open questions resolved per plan defaults (key-only URLs, generic `Error`, README note, `expiresInSeconds` ignored locally).
2. **No undocumented production deviations.** One minor difference from the backlog _example_ snippet (which rejects `rel === ''`): the approved plan does not require rejecting keys that resolve exactly to the storage root (e.g. `.`). This is consistent with the plan, not a scope deviation.
3. **Unrelated working-tree changes.** Large backlog document resynchronization is present but outside P1-01 implementation scope; recommend committing separately from the security fix.
4. **Pre-existing suite noise.** Full lint and full unit suite are not green due to outbox issues predating P1-01; these do not block approval of the security fix itself.

## Documentation alignment

- README §5.10 documents local driver returning storage key references, not filesystem paths — aligned with implementation.
- Backlog P1-01 acceptance criteria satisfied by code and tests.

## Remaining risks

| Risk                                                       | Status                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Symlink escape under storage root                          | Out of scope; documented in plan                                                     |
| Keys resolving to storage root (`rel === ''`) not rejected | Low risk; not required by approved plan; writing to directory path would fail at I/O |
| Callers expecting `putObject.url` as filesystem path       | Intended breaking change for misuse; README updated                                  |

## Unverified areas

- Full `npm run lint` and full `npm run test:unit` suite not green (pre-existing outbox failures, unrelated to P1-01).
- No integration test with HTTP download endpoint (out of scope per plan).
- Symlink-based escape not tested (explicitly out of scope).
