# Bugfix backlog index

| Issue ID | Severity | Classification   | Title                                                                  |
| -------- | -------- | ---------------- | ---------------------------------------------------------------------- |
| P1-01    | High     | Confirmed defect | Fix Redis session user-index TTL overwrite                             |
| P1-02    | High     | Confirmed defect | Purge Redis sessions and JWT refresh families on password change/reset |
| P1-03    | High     | Confirmed defect | Harden idempotency so side effects are not re-run after lock loss      |
| P1-04    | High     | Likely defect    | Make JWT refresh-family revoke atomic                                  |
| P1-05    | High     | Confirmed defect | Unwrap Drizzle unique violations so duplicate register returns 409     |

## Rules

- Add only defects confirmed against the current branch (or explicitly classified Likely with code evidence).
- Use a stable, previously unused P-level ID.
- Keep the full issue definition in `NESTJS_STARTER_KIT_REQUIRED_FIXES.md`.
- Work on one issue at a time.
- Do not mark an issue resolved without implementation and independent-verification evidence.
