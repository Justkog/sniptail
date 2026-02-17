# Contributing to Sniptail

Thanks for helping improve Sniptail! This guide covers local setup, workflows,
and what to expect when contributing.

## Project direction

Sniptail is designed to expand along three axes: the medium (where jobs are requested), the coding agent (what executes jobs), and the Git service (where changes land). Today the stack is Slack + Codex + GitHub/GitLab. Contributions that add new integrations in any of these areas are especially welcome; see the tables in `README.md` for the current support matrix.

### Adding a Git provider

Sniptail uses a shared Git provider contract in `packages/core/src/repos/providers.ts`.
To add a provider:

1. Add a `RepoProviderDefinition` entry (id, display name, capabilities).
2. Implement provider-specific hooks:
   - `validateRepoConfig`
   - `serializeProviderData` / `deserializeProviderData`
   - `createReviewRequest` (for IMPLEMENT PR/MR creation)
   - `createRepository` (for `/bootstrap`)
3. Register the provider in `REPO_PROVIDERS`.

The worker and bot bootstrap flows resolve providers through this registry, so most new-provider work is isolated to that file plus any provider-specific API client.

### Adding an agent

Agents are registered through the shared descriptor registry in
`packages/core/src/agents/agentRegistry.ts` and executed by the worker in
`apps/worker/src/agents/runAgent.ts`.

To add a new coding agent:

1. Extend agent identifiers:
   - Add the new id in `packages/core/src/types/job.ts` (`AGENT_IDS`).
   - This automatically enables `PRIMARY_AGENT` validation in
     `packages/core/src/config/resolve.ts`.
2. Implement the adapter:
   - Add a runtime module (for example `packages/core/src/<agent>/<agent>.ts`)
     exposing `run(job, workDir, env, options)` and returning
     `{ finalResponse, threadId? }`.
   - Reuse `buildPromptForJob` from `packages/core/src/agents/buildPrompt.ts`
     unless the agent needs provider-specific prompt shaping.
   - Optionally add event format/summary helpers for logs.
3. Register a descriptor in `packages/core/src/agents/agentRegistry.ts`:
   - `adapter` (required)
   - `isDockerMode(config)` (for Docker preflight checks)
   - `resolveModelConfig(config, jobType)` (per job-type model overrides)
   - `shouldIncludeRepoCache(config, jobType)` (controls `--add-dir` style access)
   - `buildRunOptions(config)` (agent-specific runtime flags/paths)
4. Wire configuration:
   - Add agent config shape in `packages/core/src/config/types.ts`
     (`WorkerConfig` and optionally `BotConfig` if needed).
   - Parse TOML/env values in `packages/core/src/config/env.ts`.
   - Add any parsing helpers in `packages/core/src/config/resolve.ts`.
   - Document new config in `sniptail.worker.toml`/`sniptail.bot.toml`
     and `.env.example` as applicable.
5. Update tests:
   - Extend config tests in `packages/core/src/config/env.test.ts`.
   - Update worker pipeline mocks in `apps/worker/src/pipeline.test.ts`
     (mocked `AGENT_DESCRIPTORS`).
   - Add/adjust Docker preflight tests in
     `apps/worker/src/docker/dockerPreflight.test.ts` when docker mode is supported.

The worker execution path is already generic (`job.agent ?? config.primaryAgent`),
so once the agent id and descriptor are registered, ASK/IMPLEMENT/PLAN/MENTION/REVIEW
jobs can route to the new adapter without additional job-runner branching.

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
5. If helpful, suggest a release-impact label (`release:patch|minor|major|none`)
   in the PR description.

## Pull request labels (release impact)

We use pull request labels to drive versioning and GitHub release notes.

Every PR merged into `staging` must have **exactly one** release-impact label:

- `release:patch` — Bug fixes or internal changes with no user-visible impact
- `release:minor` — New features or backward-compatible behavior changes
- `release:major` — Breaking changes (config, commands, behavior, data formats)
- `release:none` — Docs, refactors, CI, or changes that should not trigger a release

Contributors do **not** need to apply labels themselves — maintainers will add or
adjust the release label during review if needed. If you’re unsure which label
applies, mention it in the PR description.

## Review process

We follow standard GitHub practices:
- At least one reviewer approval is required.
- Address review comments with follow-up commits or amendments.
- Keep discussions in the PR so changes are traceable.
- Once approved and checks pass, maintainers will merge to `staging`.

By submitting a contribution, you agree that your contribution will be licensed under the Elastic License v2.
