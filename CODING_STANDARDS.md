# CODING STANDARDS (for AI agents working on this codebase)

> **READ THIS FIRST.** This document is the source of truth for how code is written, structured, and documented in this project. The human owner is a vibe coder — all code is produced by AI agents. These rules exist so that any agent (Claude, GPT, Cursor, Copilot, future-you in a new chat) can land in any file and be productive within 30 seconds.

---

## 0. Communication protocol

- **All code, identifiers, comments, commit messages, docstrings, file names, branch names, log messages, error messages → English. Always. No exceptions.**
- **All chat replies to the human owner → Russian.**
- If the human writes English in chat, still reply in Russian unless they explicitly switch.
- Never mix languages inside a single code artifact.

---

## 1. Prime directive: optimize for AI navigation

Code is read far more often by AI agents than by humans here. Every decision below serves one goal: **a fresh agent should locate the relevant code and understand its contract without reading the whole repo.**

Practical consequences:

1. **Names are self-describing.** `calculateMonthlyRecurringRevenue()` beats `calcMRR()`. `UserAuthenticationService` beats `AuthSvc`. No clever abbreviations.
2. **Files declare their purpose at the top.** Every non-trivial file starts with a header block (see §5).
3. **Searchable anchors.** Use predictable tags like `// ANCHOR: payment-webhook-handler` near critical sections. Agents grep for these.
4. **One concept per file.** If an agent has to scroll past three unrelated classes to find the one mentioned in the task, the file is too big. Split.
5. **No hidden magic.** Decorators, metaclasses, dynamic dispatch, monkey-patching → only when justified and documented. Prefer boring explicit code.
6. **Structure mirrors domain.** Folder names = bounded contexts. An agent reading `/src/billing/invoicing/` knows exactly where invoice logic lives.

---

## 2. Project design for AI navigation

Before writing any code, design the project structure so that AI agents can navigate it efficiently. These patterns apply to greenfield projects and refactors.

### 2.1 Flat bounded contexts over deep hierarchies

AI models struggle with deep nesting like `src/modules/billing/submodules/invoicing/services/core/handlers/`. Prefer:

```
src/
├── billing_invoice/       # one bounded context = one folder
├── billing_payment/
├── user_auth/
└── notification_email/
```

**Rule:** If a folder name doesn't stand alone as a meaningful concept (`core/`, `utils/`, `helpers/`), it's a code smell. Rename to what it actually contains.

### 2.2 One entity per file

Never create `services.py` with 15 classes. Instead:

```
billing_invoice/
├── invoice.py              # entity
├── invoice_repository.py   # port + impl
├── invoice_service.py      # use case
└── invoice_controller.py   # HTTP adapter
```

When an agent gets "add method to InvoiceService", it opens one file — not grep through an 800-line `services.py`.

### 2.3 Manifest file per bounded context

Add `__about__.py` (Python) or `README.md` (any language) to every domain folder:

```python
# billing_invoice/__about__.py
"""
BOUNDED CONTEXT: Invoice Management
PURPOSE: Handle invoice lifecycle from creation to payment reconciliation.
CORE ENTITIES: Invoice, InvoiceLineItem, InvoiceStatus
EXTERNAL DEPENDENCIES: PaymentGateway (port), EmailSender (port)
OWNED BY: Billing team
RELATED CONTEXTS: billing_payment, user_account
"""
```

This answers: What does this context do? What are the main entities? Who maintains it? An agent reads this first before diving into code.

### 2.4 Navigation index at project root

Create `NAVIGATION.md`:

```markdown
# Quick Navigation

## Find by concept
- **Invoices**: `src/billing_invoice/`
- **Payments**: `src/billing_payment/`
- **User auth**: `src/user_auth/`

## Find by use case
- "Create invoice": `billing_invoice/invoice_service.py::create_invoice()`
- "Process payment": `billing_payment/payment_service.py::process_payment()`

## Find by external integration
- Stripe: `billing_payment/stripe_gateway.py`
- SendGrid: `notification_email/sendgrid_client.py`
```

Agents read this to locate code by concept/use-case without grepping the entire project.

### 2.5 Explicit boundaries with `ports/` and `adapters/`

```
billing_invoice/
├── domain/
│   ├── invoice.py          # entity
│   └── invoice_policy.py   # business rules
├── ports/                  # interfaces to external world
│   ├── invoice_repository.py
│   └── payment_gateway.py
├── adapters/               # implementations of ports
│   ├── postgres_invoice_repository.py
│   └── stripe_payment_gateway.py
└── use_cases/
    └── create_invoice.py
```

**Why this matters:** When an agent sees `ports/`, it knows these are interfaces — don't change signatures without checking consumers. `adapters/` are implementation details — safe to modify as long as they satisfy the port contract.

### 2.6 Config as typed code

Not `.env` with comments. Use typed configuration:

```python
# config.py
from pydantic_settings import BaseSettings

class AppConfig(BaseSettings):
    """All values from environment variables. See .env.example."""
    database_url: str
    stripe_api_key: str
    jwt_secret: str
    jwt_expiry_minutes: int = 60
    log_level: str = "INFO"
    
    class Config:
        env_file = ".env"
```

When an agent needs to add Redis support, it opens `config.py`, sees the typed schema, adds `redis_url: str`, runs the typechecker — everything breaks where it should, easy to fix. Without types, the agent doesn't know where config is consumed.

### 2.7 Architecture Decision Records (ADRs)

Document non-trivial decisions:

```
docs/adr/
├── 0001-use-postgres-not-mongo.md
├── 0002-hexagonal-architecture.md
├── 0003-invoice-state-machine.md
└── 0004-retry-policy-for-external-apis.md
```

**Format:**

```markdown
# ADR-0003: Invoice State Machine

**Date:** 2025-04-10
**Status:** Accepted

## Context
Race conditions when multiple workers transition the same invoice.

## Decision
State machine with explicit transitions. Disallow: PAID → OPEN, VOID → any.

## Consequences
- Transitions are atomic (DB constraint).
- Migration needed for `previous_status` column.
- Logic centralized in `invoice.py::transition_to()`.

## References
- Code: `billing_invoice/domain/invoice.py`
- Issue: #142
```

When an agent sees a bug like "invoice stuck in PAID but should be VOID", it reads ADR-0003 first, understands this is a forbidden transition by design, and doesn't try to "fix" it by removing the constraint.

### 2.8 Tests mirror production structure

```
src/billing_invoice/invoice_service.py
tests/billing_invoice/test_invoice_service.py
```

Not `tests/unit/services/test_billing.py` — an agent can't tell what's inside without opening it. `tests/billing_invoice/` immediately signals what it tests.

Add a header to test files:

```python
# tests/billing_invoice/test_invoice_service.py
"""
TESTS FOR: src/billing_invoice/invoice_service.py
COVERAGE TARGET: 90%+
MOCKS: PaymentGateway (port), InvoiceRepository (port)
"""
```

### 2.9 README.md as 5-minute onboarding

```markdown
# Project Name

## What
One-sentence description.

## Quick Start
\```bash
cp .env.example .env
docker-compose up -d
poetry install && poetry run pytest
poetry run uvicorn app:main --reload
\```

## Architecture
Hexagonal (ports & adapters). See `CODING_STANDARDS.md` and `docs/adr/`.

## Key Commands
- Tests: `poetry run pytest`
- Lint: `poetry run ruff check`
- Typecheck: `poetry run mypy src/`

## Where Things Live
See `NAVIGATION.md`.
```

An agent reads this in 30 seconds, gets commands to run the project, and links to detailed docs.

### 2.10 AGENTS.md — technical guide for AI

Not about business logic, but about *how the codebase is structured for AI consumption*:

```markdown
# AGENTS.md — Guide for AI Assistants

## Project Layout
- `src/<context>/domain/` — pure business logic, no I/O
- `src/<context>/ports/` — interfaces to external systems
- `src/<context>/adapters/` — implementations (DB, HTTP, queues)

## Conventions
- One class per file.
- File header mandatory (see CODING_STANDARDS.md).
- Tests mirror src/ structure.

## Common Gotchas
- Don't import from `infrastructure/` into `domain/` — CI will fail.
- Invoice status transitions enforced at DB level (ADR-0003).
- All HTTP clients use retry middleware (`shared/http_client.py`).

## Where to Find Things
- Config: `src/shared/config.py`
- All ports: `src/*/ports/`
- DB models: `src/infrastructure/persistence/models/`
- HTTP routes: `src/interfaces/http/routers/`

## Before You Change
1. Read relevant ADR.
2. Write tests first if missing.
3. Run `make lint typecheck test` before committing.

## Adding a New Feature
1. Identify bounded context (or create folder).
2. Add domain entity/value object.
3. Define port if external dependency needed.
4. Implement use case.
5. Add HTTP adapter.
6. Write tests (80%+ coverage target).
7. Update `NAVIGATION.md` if new entry point.
```

This is an agent's roadmap. Without it, half the context window goes to learning project structure.

### 2.11 Anti-patterns to avoid

| ❌ Don't | ✅ Do Instead |
|---|---|
| Magic names (`app/`, `core/`, `utils/`) | Domain names (`billing_invoice/`, `user_auth/`) |
| Deep nesting (`src/modules/features/billing/sub/`) | Flat contexts (`src/billing_invoice/`) |
| God files (`models.py` with 20 classes) | One per file (`invoice.py`, `payment.py`) |
| Hidden deps (relative imports across half the project) | Explicit ports, dependency injection |
| Undocumented decisions ("we use Celery") | ADR explaining why Celery over RQ |

### 2.12 Project kickstart checklist

Ensure these exist before writing business logic:

- [ ] `README.md` with quick start
- [ ] `CODING_STANDARDS.md` (this file)
- [ ] `AGENTS.md` — AI navigator
- [ ] `NAVIGATION.md` — concept → file index
- [ ] `.env.example` with comments
- [ ] `docs/adr/` folder (even if empty initially)
- [ ] Structure: `domain / application / infrastructure / interfaces`
- [ ] Each bounded context in separate folder
- [ ] Header block in every file (MODULE / PURPOSE / LAYER / etc)
- [ ] Config as typed class
- [ ] Tests mirror `src/`

---

## 3. Architecture: enterprise layering

Default architecture for any non-trivial service. Skip layers only when the project is genuinely a script (<200 LOC).

```
src/
├── domain/          # Pure business logic. No I/O, no frameworks. Entities, value objects, domain events.
├── application/     # Use cases / services. Orchestrates domain + infra. Returns DTOs.
├── infrastructure/  # DB, HTTP clients, message brokers, file system. Implements ports defined in domain.
├── interfaces/      # Inbound adapters: HTTP controllers, CLI handlers, queue consumers, gRPC.
├── shared/          # Cross-cutting: logging, config, errors, types.
└── tests/           # Mirrors src/ structure. Unit + integration + e2e subfolders.
```

**Rules:**
- Dependencies point inward: `interfaces → application → domain`. `infrastructure` implements interfaces declared in `domain` (ports & adapters / hexagonal).
- Domain layer has zero external imports beyond stdlib and pure utility libs.
- Cross-layer DTOs are explicit types — never pass raw DB rows up to controllers.
- Every external dependency (DB, third-party API, queue) is behind a port (interface). Tests substitute fakes.

---

## 3. Type system

- **Types are mandatory.** Python → full type hints + `mypy --strict` clean. TypeScript → `strict: true`, no `any` without a comment justifying it. Go/Rust → idiomatic.
- **No primitive obsession.** `UserId` is its own type, not `string`. Use branded/nominal types or value objects.
- **Make illegal states unrepresentable.** Prefer discriminated unions / sum types over flag fields. `type Result<T,E> = { ok: true, value: T } | { ok: false, error: E }`.
- **Errors are values, not surprises.** Return `Result` types or use exception classes that inherit from a project base error. Never throw raw strings.
- **Public functions have explicit return types.** Even if inferable.

---

## 4. File header convention (CRITICAL for AI navigation)

Every source file starts with this block:

```python
"""
MODULE: billing.invoicing.invoice_service
PURPOSE: Orchestrates invoice creation, sending, and lifecycle transitions.
LAYER: application
DEPENDENCIES (ports): InvoiceRepository, EmailSender, PaymentGateway
CONSUMED BY: interfaces.http.invoice_controller, interfaces.cli.billing_cli
INVARIANTS:
  - An invoice cannot transition from PAID back to OPEN.
  - Total must equal sum of line items.
RELATED DOCS: docs/billing.md, docs/adr/0007-invoice-state-machine.md
"""
```

For TypeScript / Go, use equivalent doc-comments at top of file. Same fields, same order.

**Why each field:**
- `MODULE` — fully qualified path. Agent can grep this exact string.
- `PURPOSE` — one sentence. If you can't write one, the file does too much.
- `LAYER` — instantly tells an agent which rules apply.
- `DEPENDENCIES` — what this file needs to function.
- `CONSUMED BY` — reverse index. Knowing who calls this file is half the battle when refactoring.
- `INVARIANTS` — business rules the file enforces. Prevents agents from "fixing" code that is correct.
- `RELATED DOCS` — pointers to context.

---

## 5. Function & class conventions

- **Functions: max ~40 lines, single responsibility, ≤4 parameters.** Beyond that, extract or introduce a parameter object.
- **Docstring required on every public function/class.** Format:
  ```
  Purpose:    one line.
  Args:       param — what it means (not just type).
  Returns:    what the value represents.
  Raises:     which errors and when.
  Example:    minimal usage snippet.
  Notes:      side effects, ordering, perf characteristics.
  ```
- **Constructors do no work.** No I/O, no network, no DB. Use factory methods (`Invoice.create_for_customer(...)`) for logic.
- **Pure functions whenever possible.** Side effects live at the edges (infrastructure, interfaces).
- **Immutability by default.** `readonly`, `frozen=True`, `const`, `final`. Mutate only when justified.

---

## 6. Naming

| Thing | Convention | Example |
|---|---|---|
| Class | PascalCase, noun | `InvoiceRepository` |
| Function | camelCase / snake_case (lang idiom), verb | `sendInvoiceEmail` / `send_invoice_email` |
| Constant | SCREAMING_SNAKE | `MAX_RETRY_ATTEMPTS` |
| Private | leading `_` or language idiom | `_internalCache` |
| Boolean | `is/has/can/should` prefix | `isPaid`, `hasOverdueBalance` |
| File | matches main export, kebab or snake per lang | `invoice-service.ts` / `invoice_service.py` |
| Folder | lowercase, domain noun | `billing/`, `notifications/` |
| Test | `<unit>_<scenario>_<expected>` | `test_invoice_create_with_zero_total_raises` |

Avoid: `data`, `info`, `manager`, `helper`, `utils` as standalone names. Be specific.

---

## 7. Anchors and grep-ability

When code has a critical point an agent might need to find later, leave a marker:

```python
# ANCHOR: stripe-webhook-signature-verification
# ANCHOR: race-condition-fix-2025-Q4
# TODO(agent): handle partial refunds — see ADR-0012
# WARNING: this order matters, see invariant in invoice_service.py
```

Convention:
- `ANCHOR:` — semantic landmark, permanent.
- `TODO(agent):` — work for a future AI session.
- `TODO(human):` — needs human decision.
- `WARNING:` — non-obvious constraint.
- `HACK:` — known wart, link to issue.

---

## 8. Errors & logging

- **One project-wide base error class.** All custom errors inherit from it (`AppError` / `DomainError` / etc).
- **Errors carry structured context**, not just a message: `raise InvoiceNotFoundError(invoice_id=id, tenant_id=tid)`.
- **Logs are structured (JSON).** Never `print`. Levels: `debug | info | warn | error | fatal`.
- **Every log line at `warn+` includes a correlation/request ID.**
- **Never log secrets, tokens, PII, full request bodies.** Redact.

---

## 9. Testing

- **Coverage target: 80%+ for `domain` and `application`. Infrastructure can be lower.**
- **Test names describe behavior, not implementation.** `it_charges_late_fee_when_invoice_is_overdue_by_30_days` not `test_charge_method`.
- **AAA pattern: Arrange / Act / Assert** — separate with blank lines.
- **No mocks of code you own beyond ports.** Use real domain objects, fake adapters.
- **Each bug fix gets a regression test first.**

---

## 10. Configuration & secrets

- **All config via environment variables, validated at startup** (pydantic-settings / zod / envconfig).
- **No secrets in code, ever.** Not in tests, not in fixtures, not in commit history.
- **`.env.example` always up to date** — agent should be able to bootstrap from it.
- **Config object is typed and injected**, not imported globally.

---

## 11. Git & commits

- **Branch:** `feat/<short-slug>`, `fix/<short-slug>`, `chore/<short-slug>`, `refactor/<short-slug>`.
- **Commit message (Conventional Commits):**
  ```
  feat(billing): add late fee calculation for overdue invoices

  - introduces LateFeePolicy value object
  - applies fee on invoice fetch if overdue > 30d
  - covered by 4 new unit tests

  Refs: #142
  ```
- **One logical change per commit.** Refactors and features don't mix.
- **Never force-push shared branches.**

---

## 12. Documentation that lives in the repo

Mandatory files at repo root:

- `README.md` — what the project is, how to run it, how to test it. 5-minute onboarding.
- `AGENTS.md` — pointers for AI agents: where things live, current conventions, gotchas. Updated whenever architecture shifts.
- `CODING_STANDARDS.md` — this file.
- `docs/adr/` — Architecture Decision Records. Every non-trivial decision gets a numbered ADR (`0001-use-postgres.md`). Format: Context / Decision / Consequences.
- `docs/<domain>.md` — one doc per bounded context explaining the domain language and rules.

---

## 13. Task delegation (cost-aware model routing)

This project is built by AI agents. Agent time costs money. **Route every task to the cheapest model that can do it correctly.** The primary agent (expensive, reasoning-capable model — Claude Opus / GPT-5-class) is a tech lead, not a grep tool.

### Decision rule

Before doing any task yourself, ask: *"Can a fast, cheap model (Claude Haiku / Gemini Flash / GPT-mini-class) solve this in one shot with a clear prompt and bounded output?"* If yes → delegate. If no → do it yourself.

### Delegate to a cheap sub-agent

These tasks are mechanical, have a clear pass/fail, and don't require holding the whole project in context:

| Task type | Example |
|---|---|
| File location | "Find the file that defines `InvoiceRepository`." |
| Pattern search | "List all call sites of `send_email()` in `src/`." |
| Extraction | "Return all exported function names from `billing/invoicing/`." |
| Counting / stats | "How many lines in `domain/`? How many TODOs?" |
| Single-file summary | "Summarize `payment_gateway.py` in 5 bullets." |
| Lint/typecheck triage | "Run mypy, return errors grouped by file." |
| Boilerplate from template | "Generate a CRUD controller for `Product` matching the pattern in `invoice_controller.py`." |
| Test scaffolding | "Create empty test stubs for every public method of `InvoiceService`." |
| Doc lookup | "Find which ADR covers the invoice state machine." |
| Format/style fixes | "Apply ruff/prettier to these files." |
| Dependency check | "Does `pyproject.toml` already list `pydantic`?" |
| Mechanical refactor | "Rename `calcMRR` to `calculateMonthlyRecurringRevenue` across the repo." |

**Sub-agent prompt template:**

```
ROLE: Code retrieval/transformation sub-agent. Mechanical task only — no architectural judgment.
TASK: <one sentence>
INPUT: <files / directories in scope>
OUTPUT FORMAT: <exact shape — JSON / list / diff>
CONSTRAINTS: do not modify files outside <scope>; if ambiguous, return "AMBIGUOUS: <reason>" instead of guessing.
RETURN: <expected return>
```

### Keep on the primary (expensive) agent

These require holding the system in mind, understanding invariants, or making judgment calls:

- Architectural decisions and ADR authorship.
- Refactors that cross layers or touch invariants.
- Reviewing logic for correctness (not just syntax).
- Debugging non-trivial bugs (race conditions, state machine violations, perf regressions).
- Designing ports / domain models / DTO boundaries.
- Resolving ambiguous requirements with the human.
- Trade-off analysis (which library, which pattern, which migration strategy).
- Writing or updating this document and `AGENTS.md`.

### Workflow pattern

The primary agent acts as orchestrator:

```
1. Receive task from human.
2. Decompose into subtasks.
3. For each subtask, decide: delegate or self-execute.
4. Dispatch delegations in parallel where possible.
5. Aggregate results, apply judgment, present to human.
```

Never delegate a task whose output you wouldn't recognize as wrong. If you can't verify the sub-agent's answer cheaply, do it yourself.

### Anti-patterns

- ❌ Reading 40 files yourself to find one function. → Delegate the search.
- ❌ Delegating "refactor the auth flow" to Haiku. → Too much context required.
- ❌ Delegating without an exact output format. → You'll spend more tokens parsing the reply than you saved.
- ❌ Doing five sequential delegations when they're independent. → Parallelize.

---

## 14. When in doubt

1. **Boring beats clever.** Clever code costs the next agent time.
2. **Explicit beats implicit.** Always.
3. **Smaller surface area beats reusability you might need.** Don't generalize until the third use case.
4. **Ask the human in Russian before introducing:** a new framework, a new external dependency, a new architectural pattern, a breaking schema change.
5. **If a rule here blocks a clearly better solution — flag it to the human, don't silently break it.**

---

*Last updated: 2026-05-15. Update the date and add a `## Changelog` entry when you modify this file.*
