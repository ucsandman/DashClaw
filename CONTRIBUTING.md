# Contributing to DashClaw

First off, thank you for considering contributing to DashClaw! It's people like you that make DashClaw such a great tool for the AI agent community.

## Code of Conduct

By participating in this project, you agree to abide by the standard Open Source Code of Conduct. Please be respectful and professional in all interactions.

## Development Setup

To get started with the codebase:

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/ucsandman/DashClaw.git
    cd DashClaw
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    Copy the example environment file and fill in your details:
    ```bash
    cp .env.example .env.local
    ```
    You will need a PostgreSQL connection string for `DATABASE_URL`.
    Run local Postgres via Docker (recommended) or use Neon (hosted):
    ```bash
    docker compose up -d db
    # DATABASE_URL=postgresql://dashclaw:dashclaw@localhost:5432/dashclaw
    ```

4.  **Run the Development Server**:
    ```bash
    npm run dev
    ```
    Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

5.  **Run Tests**:
    ```bash
    npm run test -- --run
    ```

6.  **Run Migrations** (idempotent, safe to re-run):
    ```bash
    npm run db:migrate
    ```
    This runs `scripts/auto-migrate.mjs`, which auto-loads `.env.local` and
    applies every `drizzle/*.sql` migration in order. Run it after pulling any
    change that touches `schema/schema.js` or `drizzle/`.

## Project Structure

-   `app/`: The Next.js 16 dashboard (App Router), API routes, and UI components.
-   `mcp-server/`: MCP server exposing governance tools (handoffs, secret rotation, skill safety, open loops, learning, audit retrospection) — the canonical agent-toolkit surface (replaces the retired Python `agent-tools/` CLI).
-   `sdk/`: The Node.js DashClaw SDK for instrumenting agents.
-   `sdk-python/`: The Python DashClaw SDK and parity test suite.
-   `scripts/`: Utility scripts for migrations, security scanning, and testing.
-   `.claude/skills/`: Claude Code skills (platform intelligence, diagnostics, integration validation).

## Documentation Update Protocol

When changing architecture, behavior, or roadmap:

1.  Update canonical docs according to `docs/documentation-governance.md`.
2.  If behavior changed, update a decision record in `docs/decisions/`.
3.  If roadmap milestones changed, update `docs/rfcs/platform-convergence-status.md`.
4.  Include doc updates in the same PR as code changes.

## Pull Request Process

We welcome Pull Requests for bug fixes, features, and documentation improvements!

What is a pull request (PR)?

A PR is a proposed change to the repository. It lets CI run checks and lets maintainers review changes before merging them into `main`.

1.  Create a new branch for your work.
2.  Ensure your code follows the existing style and patterns.
3.  **Run the verification gates** before submitting:
    ```bash
    npm run lint
    npx vitest run            # the FULL suite — targeted runs miss regressions in unrelated files
    npx next build            # required for any change under app/**
    npm run typecheck         # required for any changed .ts file (vitest transpiles without type-checking; the build will not)
    ```
4.  **Run CI parity checks locally** before opening a PR:
    ```bash
    npm run scripts:check-syntax
    npm run docs:check
    npm run openapi:check
    npm run api:inventory:check
    npm run route-sql:check
    node scripts/check-doc-counts.mjs --strict
    ```
5.  Submit your PR with a clear description of the changes and the problem they solve.

### Dependabot PRs

This repository uses Dependabot to propose dependency updates. Treat them like normal PRs:

- Patch/minor updates: merge when CI is green.
- Major updates: treat as planned work (read release notes, test locally, and expect breaking changes).

## Code Style

-   **JavaScript**: We use standard ESLint configurations provided by Next.js.
-   **CSS**: We use Tailwind CSS for all styling. Please use utility classes rather than custom CSS where possible.
-   **Icons**: Use `lucide-react` for all iconography to maintain visual consistency.

## Security

If you discover a security vulnerability, please do NOT open a public issue. Instead, contact the maintainers directly so we can address it responsibly.

Happy coding!
