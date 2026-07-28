---
adr: ADR-001
title: Module reuse model
status: accepted
date: 2026-07-25
decision: B — documented copy-kit
---

# ADR-001 — Module reuse model (documented copy-kit)

## Context

This repository positions itself as a portable NestJS backend foundation. Integrators and reviewers reasonably ask whether reuse means `npm install @org/<module>` or copy/fork.

Facts on the current branch:

- Root `package.json` is `"private": true` with no `workspaces` and no `publishConfig`.
- There are no `libs/*/package.json` manifests — libraries resolve via TypeScript path aliases (`@domain/*`, `@application/*`, `@contracts/*`, `@infrastructure/*`, `@shared/*`).
- `nest-cli.json` lists app projects only; libs are not Nest library projects.
- Official distribution is a **source archive** (`scripts/release/*` → `git archive`), not npm packages.
- Product docs already describe copying the foundation into a new project.
- Earlier docs overstated portability by implying every reusable infrastructure module exposes `forRoot` / `forRootAsync` (see the registration matrix).

Publishing extractable npm packages (workspaces, per-lib manifests, export maps, optional registry) remains a valid future direction, but it is a packaging project with lockfile and resolution risk — not the truthful description of today’s reuse story.

## Decision

**Choose model (B) — documented copy-kit.**

Reuse across projects means:

1. Copy or archive the starter (or selected source folders) into another codebase.
2. Wire path aliases (or rewrite imports) and register modules via their **actual** public APIs (`forRoot` / `forRootAsync`, `register` / `registerAsync`, or static `@Module`).
3. Follow the per-module peer, token, and config notes in [`docs/infrastructure-modules/EXTRACTION_GUIDE.md`](../infrastructure-modules/EXTRACTION_GUIDE.md).

This repository does **not** ship publishable npm packages in this iteration.

## Consequences

- **Positive:** Documentation matches packaging reality; integrators get actionable extraction steps; no lockfile / workspace / Nest build-path churn; archive release flow stays the official distribution mechanism.
- **Positive:** Registration matrix and extraction guide stay aligned with actual module APIs without inventing package boundaries.
- **Negative / deferred:** Consumers cannot `npm install` individual libs from a registry. Model **(A) publishable packages** is deferred to a future task once the copy-kit matrix and peer notes are stable.
- **Operational:** Do not copy `.env` or secrets; copy schema/options mapping patterns only.

## Non-goals (this ADR)

- Introducing npm workspaces, per-lib `package.json`, export maps, or registry publish CI.
- Replacing or removing `scripts/release/*` archive distribution.
- Refactoring module registration APIs (owned by other tasks).
- Changing runtime behavior of API, Worker, Cron, or Migrations.

## References

- Registration matrix: [`docs/infrastructure-modules/README.md`](../infrastructure-modules/README.md)
- Extraction guide: [`docs/infrastructure-modules/EXTRACTION_GUIDE.md`](../infrastructure-modules/EXTRACTION_GUIDE.md)
- Release archive: `scripts/release/build-archive.ts` (`npm run release:archive`)
