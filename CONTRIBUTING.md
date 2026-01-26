# Contributing to Sniptail

Thanks for helping improve Sniptail! This guide covers local setup, workflows,
and what to expect when contributing.

## Project direction

Sniptail is designed to expand along three axes: the medium (where jobs are requested), the coding agent (what executes jobs), and the Git service (where changes land). Today the stack is Slack + Codex + GitHub/GitLab. Contributions that add new integrations in any of these areas are especially welcome; see the tables in `README.md` for the current support matrix.

## Local setup

Prereqs:
- Node.js (tested with Node 22)
- PNPM
- Redis (for the job queue)
- Git + SSH access for repo operations
- Codex CLI and/or Copilot CLI (depending on execution mode)
- Docker (required when running agents in docker mode)

Steps:
1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create `.env` from `.env.example` and fill required values (see `README.md`).
3. Start dev mode:
   ```bash
   pnpm run dev
   ```

## Tests and checks

Common commands:
- Run tests (watch mode): `pnpm test`
- Run tests once: `pnpm run test:run`
- Lint: `pnpm run lint`
- Format: `pnpm run format`
- Typecheck / checks: `pnpm run check`

## Branching model

This repo uses `staging` as the primary integration branch. Please:
- Branch from `staging` for most work.
- Open merge requests / pull requests targeting `staging`.
- `main` is reserved for releases or promotion from `staging`.

Note: This differs from the common default of branching from `main`. If this
ever changes, prefer the latest guidance in the issue or PR template.

## Commit message style

We use Conventional Commits. The typical pattern is:

`type(scope): description`

Examples:
- `feat(worker): add job timeout`
- `fix(bot): handle missing Slack token`
- `docs(readme): update setup steps`

See https://www.conventionalcommits.org/ for details on allowed `type` values.

## Submitting a PR

1. Create a branch from `staging`.
2. Make focused changes and keep the diff minimal.
3. Ensure tests/checks pass (or note what you could not run).
4. Open a PR targeting `staging` with a clear description and any screenshots
   or logs if relevant.

## Review process

We follow standard GitHub practices:
- At least one reviewer approval is required.
- Address review comments with follow-up commits or amendments.
- Keep discussions in the PR so changes are traceable.
- Once approved and checks pass, maintainers will merge to `staging`.
