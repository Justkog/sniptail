# AGENTS.md

## Project overview
- Sniptail is a Slack bot that queues and runs Codex-backed jobs (ASK/IMPLEMENT/MENTION) via BullMQ and Redis.
- Entry points: `apps/bot/src/index.ts` starts the Slack app (Socket Mode) and `apps/worker/src/index.ts` starts the worker.

## Stack
- Node.js + TypeScript (ESM), PNPM workspaces
- Slack Bolt, BullMQ, Redis
- OpenAI Codex SDK

## TypeScript guideline
- Prefer optional properties/parameters when something may be absent; avoid explicit nullable types like `foo: string | null` unless null has a distinct meaning.

## Key paths
- `apps/bot/src/index.ts`: Slack app bootstrap
- `apps/bot/src/slack/features/`: Slack feature modules (grouped by capability)
  - `actions/`: interactive action handlers (ask/implement/worktree/clear)
  - `commands/`: slash command handlers (ask/implement/usage/bootstrap/clear)
  - `events/`: Slack event handlers (app mentions, etc.)
  - `views/`: modal submission handlers (ask/implement/bootstrap)
  - `context.ts`: shared Slack feature context helpers
- `apps/worker/src/index.ts`: worker bootstrap
- `apps/worker/src/job/runJob.ts`: job orchestration (ASK/IMPLEMENT/MENTION flow)
- `apps/worker/src/job/records.ts`: job record/thread resolution helpers
- `apps/worker/src/job/artifacts.ts`: job artifact/log handling
- `apps/worker/src/repos/`: git clone/worktree/check/commit helpers
- `apps/worker/src/agents/runAgent.ts`: agent selection + execution
- `apps/worker/src/merge-requests/`: PR/MR creation + description helpers
- `apps/worker/src/channels/`: notification abstraction (Slack notifier today)
- `apps/worker/src/slack/`: Slack-specific payload helpers
- `packages/core/src/slack/`: Slack commands, modals, and event handlers
- `packages/core/src/queue/`: BullMQ queue wiring
- `packages/core/src/git/`: Git operations and repo management
- `packages/core/src/codex/`: Codex SDK integration and execution
- `packages/core/src/config/env.ts`: env var schema + validation
- `scripts/`: helper scripts (notably `scripts/codex-docker.sh`)

## Environment
Populate `.env` from `.env.example`. Required vars are enforced in `packages/core/src/config/env.ts`.

Notable variables:
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
- `REDIS_URL`
- `GITLAB_BASE_URL`, `GITLAB_TOKEN`
- `REPO_ALLOWLIST_PATH` (JSON file; see below)
- `REPO_CACHE_ROOT`, `JOB_WORK_ROOT`, `JOB_REGISTRY_PATH`
- `LOCAL_REPO_ROOT` (optional; restricts local bootstrap paths)
- `CODEX_EXECUTION_MODE` (`local` or `docker`)
- `CODEX_DOCKERFILE_PATH`, `CODEX_DOCKER_IMAGE`, `CODEX_DOCKER_BUILD_CONTEXT`

`REPO_ALLOWLIST_PATH` JSON shape:
```json
{
  "repo-key": {
    "sshUrl": "git@gitlab.com:org/repo.git",
    "projectId": 12345
  },
  "local-repo": {
    "localPath": "/srv/repos/my-local-repo"
  }
}
```

## Local development
```bash
pnpm install
pnpm run dev
```

## Build and run
```bash
pnpm run build
pnpm run start
```

## Lint/format
```bash
pnpm run lint
pnpm run format
pnpm run check
```

## Docker/Codex execution
- `scripts/codex-docker.sh` wraps Codex in Docker and mounts requested paths.
- Configure `CODEX_EXECUTION_MODE=docker` and the Docker vars in `.env` to run Codex jobs in a container.
