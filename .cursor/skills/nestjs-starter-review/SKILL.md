---
name: nestjs-starter-review
description: Perform an evidence-based architecture, DI, runtime and production-readiness review of this NestJS starter kit.
---

# NestJS Starter Review

## Use this skill when

The user requests a full project review, architecture audit, DI audit, portability review, production-readiness review or verification of a branch after broad changes.

## Required sources

Read completely and in this order:

1. `README.md`
2. `MODULES_OVERVIEW_NON_TECH.md`
3. `EXAMPLES.md`
4. `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`
5. `AGENTS.md`

Use the review prompt as the detailed rubric. This skill defines the execution workflow and output location.

## Workflow

### 1. Establish scope

- Inspect `git status` and the current diff.
- Determine whether the review is full-repository, branch-diff or issue-specific.
- Do not edit production code.

### 2. Inventory

Inspect:

- `package.json` and `package-lock.json`;
- `tsconfig.json` and `apps/*/tsconfig.app.json`;
- `nest-cli.json`;
- Dockerfiles and Compose files;
- `.env.example`;
- all entrypoints and root modules;
- dynamic modules, providers, exports and tokens;
- Drizzle schema and migrations;
- Domain, Application, Contracts, Infrastructure and Interface boundaries.

Build an internal map:

```text
entrypoint
  -> root module
    -> imported module
      -> provider
        -> token
          -> implementation
```

### 3. Runtime verification

When the environment permits, execute:

```bash
npm ci
npm run build
npm run lint
npm run test:unit
npm run test:int
```

Then bootstrap the affected entrypoints and inspect migration startup where safe.

For every command record:

```text
Command:
Result:
Conclusion:
```

Separate project failures from unavailable PostgreSQL, Redis, SMTP, S3 or other external services.

### 4. Evidence-based findings

Each finding must contain at least one:

- exact file and symbol;
- import or dependency chain;
- provider/token registration chain;
- configuration fragment;
- command output;
- documentation contradiction.

Classify findings as:

- Confirmed defect;
- Likely defect;
- Architectural risk;
- Documentation mismatch.

Do not present an architectural risk as a proven runtime failure.

### 5. Output

Write the report to:

```text
docs/agent-reports/full-review-YYYY-MM-DD.md
```

Use the report format from `docs/agent-workflow/NESTJS_STARTER_KIT_REVIEW_PROMPT.md`.

## Guardrails

- Do not fix issues during review.
- Do not invent missing files, symbols or runtime behavior.
- Do not treat Prettier or formatting-only lint output as architecture defects.
- Do not duplicate one root cause across several findings.
- Mark areas that cannot be verified as `Not confirmed` and explain why.
