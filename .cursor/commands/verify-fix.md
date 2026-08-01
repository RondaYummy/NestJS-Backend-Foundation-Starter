---
name: verify-fix
description: Independently verify one implemented issue without changing production code.
---

Use the `independent-verifier` subagent and the `change-verification` skill.

Use exactly one issue ID.
Read its source issue, approved plan, actual diff and implementation report.
When HTTP endpoints changed, verify OpenAPI and Postman coverage; reject secrets in collection/env.
Do not modify production code.
Write a verification report with verdict `approved`, `changes-required` or `not-confirmed`.
