---
name: task-verification
description: Independently verify one implemented new task against its approved specification, approved plan, actual diff and acceptance criteria without modifying code.
---

# Task Verification

## Required inputs

Use exactly one task ID.

Read:

1. `docs/agent-tasks/INDEX.md`;
2. the approved task specification;
3. the approved implementation plan;
4. the implementation report, if present;
5. actual `git status` and `git diff`;
6. every changed file;
7. all affected providers, consumers, entrypoints and public contracts.

Do not trust the implementation report without checking the code.

## Workflow

### 1. Approval and scope checks

Confirm:

- specification status is `approved`;
- plan status is `approved`;
- exactly one task was implemented;
- the diff does not include unrelated work;
- every plan deviation is documented;
- no acceptance criterion was removed or weakened.

### 2. Architecture verification

Verify, where applicable:

- dependency direction;
- Domain and Application boundaries;
- provider/token registration;
- module imports and exports;
- entrypoint-specific composition;
- transaction boundaries;
- business write plus Outbox atomicity;
- queue idempotency and retry behavior;
- migration ordering and compatibility;
- lifecycle and graceful shutdown;
- configuration portability.

### 3. Functional verification

Check every functional and non-functional requirement.

For every added or changed HTTP endpoint, compare generated OpenAPI with the controller method/path, validation DTO, actual success body, exception envelope, auth, headers and cookies, and run the repository OpenAPI drift test.

Create an acceptance matrix:

```text
Requirement | Evidence | Result
FR-01       | ...      | passed / failed / not-confirmed
NFR-01      | ...      | passed / failed / not-confirmed
AC-01       | ...      | passed / failed / not-confirmed
```

Static inspection is not sufficient when runtime behavior is required.

### 4. Security and operational verification

Where applicable, verify:

- authorization and permission checks;
- validation and error handling;
- secret handling;
- rate limiting;
- sensitive logging;
- metrics, tracing and correlation;
- readiness and startup failure behavior;
- rollback and deployment assumptions.

### 5. Commands

Execute targeted commands from the plan, followed by required full checks.

For each command record:

```text
Command:
Result:
Conclusion:
```

Separate:

- project defects;
- expected failures caused by unavailable infrastructure;
- unverified areas.

### 6. Verification report

Create:

```text
docs/agent-reports/<task-id>-verification.md
```

Use this structure:

```markdown
# <Task ID> — Independent verification

## Verdict

approved | changes-required | not-confirmed

## Approved specification

## Approved plan

## Scope checked

## Actual changed files

## Requirements matrix

## Acceptance criteria matrix

## Architecture and DI verification

## Database and migration verification

## Security verification

## Commands executed

## Findings

## Documentation alignment

## Remaining risks

## Unverified areas
```

## Verdict rules

Use `approved` only when:

- every required acceptance criterion passed;
- no high-impact scope or architecture defect remains;
- required command evidence is available.

Use `changes-required` when:

- one or more requirements failed;
- the implementation does not match the approved specification or plan;
- unrelated changes were introduced.

Use `not-confirmed` when:

- required infrastructure or evidence is unavailable;
- runtime behavior cannot be safely verified.

## Guardrails

- Do not modify production code.
- Do not automatically fix findings.
- Do not approve solely because build passes.
- Do not trust generated reports without checking the actual diff.
- Do not create commits, push, switch branches or rewrite history.
