---
name: change-verification
description: Independently verify one implemented bugfix against its source issue, approved plan, diff, acceptance criteria and runtime evidence without modifying code.
---

# Independent Change Verification

## Required inputs

Read:

1. the issue ID in `docs/agent-backlog/INDEX.md`;
2. the matching source issue;
3. the approved plan in `docs/agent-plans/`;
4. the implementation report, if present;
5. actual `git status` and `git diff`;
6. every changed file and affected provider/consumer.

Do not trust the implementation report without checking the code.

## Workflow

### 1. Scope verification

Confirm:

- only the selected issue was implemented;
- no unrelated refactor or behavior change was introduced;
- all planned files and symbols were handled;
- any deviation is documented and justified.

### 2. Root-cause verification

Confirm the implementation addresses the original root cause rather than only suppressing symptoms.

Trace affected flows, including where relevant:

```text
consumer
  -> token or port
    -> provider declaration
      -> exporting module
        -> importing composition root
          -> concrete implementation
```

### 3. Acceptance matrix

Check every acceptance criterion individually and classify it:

- passed;
- failed;
- not confirmed.

Static inspection is insufficient where runtime behavior is part of the criterion.

### 4. Commands

Execute targeted commands from the plan, then required full checks.

For each command record:

```text
Command:
Result:
Conclusion:
```

Separate project failures from unavailable external infrastructure.

### 5. Report

Write:

```text
docs/agent-reports/<issue-id>-verification.md
```

Use this structure:

```markdown
# <Issue ID> — Independent verification

## Verdict
approved | changes-required | not-confirmed

## Scope checked
## Root-cause assessment
## Acceptance criteria matrix
## Dependency and DI verification
## Commands executed
## Findings
## Documentation alignment
## Remaining risks
## Unverified areas
```

## Guardrails

- Do not modify implementation code.
- Do not automatically fix discovered defects.
- Do not approve solely because build passes.
- Do not approve when a required acceptance criterion failed.
- Use `not-confirmed` when infrastructure or evidence is insufficient.
