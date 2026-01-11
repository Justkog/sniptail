# AGENTS.md

## Project overview
- Sniptail is a Slack bot that queues and runs Codex-backed jobs (ASK/IMPLEMENT/MENTION) via BullMQ and Redis.
- Entry point: `src/index.ts` starts the Slack app (Socket Mode) and the worker.

## Stack
- Node.js + TypeScript (ESM)
- Slack Bolt, BullMQ, Redis
- OpenAI Codex SDK

## Key paths
- `src/index.ts`: app bootstrap
- `src/slack/`: Slack commands, modals, and event handlers
- `src/worker/`: job execution
- `src/queue/`: BullMQ queue wiring
- `src/git/`: Git operations and repo management
- `src/codex/`: Codex SDK integration and execution
- `src/config/env.ts`: env var schema + validation
- `scripts/`: helper scripts (notably `scripts/codex-docker.sh`)

## Environment
Populate `.env` from `.env.example`. Required vars are enforced in `src/config/env.ts`.

Notable variables:
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
- `REDIS_URL`
- `GITLAB_BASE_URL`, `GITLAB_TOKEN`
- `REPO_ALLOWLIST_PATH` (JSON file; see below)
- `REPO_CACHE_ROOT`, `JOB_WORK_ROOT`, `JOB_REGISTRY_PATH`
- `CODEX_EXECUTION_MODE` (`local` or `docker`)
- `CODEX_DOCKERFILE_PATH`, `CODEX_DOCKER_IMAGE`, `CODEX_DOCKER_BUILD_CONTEXT`

`REPO_ALLOWLIST_PATH` JSON shape:
```json
{
  "repo-key": {
    "sshUrl": "git@gitlab.com:org/repo.git",
    "projectId": 12345
  }
}
```

## Local development
```bash
npm install
npm run dev
```

## Build and run
```bash
npm run build
npm run start
```

## Lint/format
```bash
npm run lint
npm run format
npm run check
```

## Docker/Codex execution
- `scripts/codex-docker.sh` wraps Codex in Docker and mounts requested paths.
- Configure `CODEX_EXECUTION_MODE=docker` and the Docker vars in `.env` to run Codex jobs in a container.
