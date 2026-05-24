# Architecture Decision Records

> Numbered records of non-trivial decisions. Format per [CODING_STANDARDS.md §2.7](../../CODING_STANDARDS.md): Context / Decision / Consequences / References.

## When to write an ADR

Write one when a decision:
- Affects multiple bounded contexts
- Changes a pattern documented in [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- Introduces a new external dependency
- Picks one of multiple defensible options (so the next agent knows *why*, not just *what*)

Do **not** write ADRs for routine implementation choices that fit existing patterns. ADRs are about *why* + *what was rejected*, not *what was built*.

## Naming

`NNNN-short-kebab-slug.md` where `NNNN` is a zero-padded sequence number starting at `0001`. Never renumber.

## Template

See [0000-template.md](./0000-template.md). Copy, increment number, fill in.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| 0000 | [Template](./0000-template.md) | n/a | 2026-05-24 |
| 0001 | [REST Route Handlers as the default for mutations](./0001-rest-routes-over-server-actions.md) | Accepted | 2026-05-24 |
| 0002 | [Throw typed exceptions from an `AppError` hierarchy](./0002-throw-with-app-error-hierarchy.md) | Accepted | 2026-05-24 |
| 0003 | [Repository ports in `domain/` with Prisma adapters in `infrastructure/`](./0003-repository-port-pattern-with-prisma.md) | Accepted | 2026-05-24 |
