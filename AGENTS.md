# AGENTS.md

## Project overview

- Sniptail is an omnichannel bot that queues and runs configurable coding-agent jobs (ASK/IMPLEMENT/MENTION) via BullMQ and Redis.
- Entry points: `apps/bot/src/index.ts` starts the Slack app (Socket Mode) and `apps/worker/src/index.ts` starts the worker.
- CLI entrypoint: `packages/cli/src/index.ts` provides the `sniptail` command and delegates runtime commands to bot/worker dist entrypoints.
- Deployment model: `apps/bot` and `apps/worker` are intended to run on different machines and must not rely on any shared filesystem between them.

## Stack

- Node.js + TypeScript (ESM), PNPM workspaces
- Slack Bolt, BullMQ, Redis
- OpenAI Codex SDK, GitHub Copilot CLI, OpenCode

## TypeScript guideline

- Prefer optional properties/parameters when something may be absent; avoid explicit nullable types like `foo: string | null` unless null has a distinct meaning.

## File naming guideline

- Do not create or rename files so that two files share the same basename in this repository.

## Shell scripting guideline

- Prefer portable Bash that works on Linux and macOS CI environments.
- Treat Bash 3.2 compatibility as the baseline for repository scripts unless a script explicitly enforces a newer shell.
- Do not use Bash 4+ only features in shared scripts (for example `mapfile`/`readarray`, associative arrays, or `coproc`) unless the script also guarantees a compatible runtime.
- When collecting command output into arrays, prefer `while IFS= read -r ...; do ...; done` patterns that work across older Bash versions.

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
- `apps/worker/src/cli/`: worker-side CLI entrypoints (`run-job`, `sync-allowlist-file`, `repos`)
- `packages/core/src/repos/catalog.ts`: repository catalog storage (DB-backed allowlist + seed/sync helpers)
- `packages/core/src/slack/`: Slack commands, modals, and event handlers
- `packages/core/src/queue/`: BullMQ queue wiring
- `packages/core/src/git/`: Git operations and repo management
- `packages/core/src/codex/`: Codex SDK integration and execution
- `packages/core/src/copilot/`: Copilot CLI integration and execution
- `packages/core/src/opencode/`: OpenCode integration and execution
- `packages/core/src/config/env.ts`: env var schema + validation
- `packages/cli/src/index.ts`: top-level CLI registration (`bot`, `worker`, `run-job`, `repos`, `slack-manifest`)
- `packages/cli/src/lib/runtime.ts`: shared runtime launcher used by CLI commands to invoke app entrypoints
- `packages/cli/src/commands/repos.ts`: operator-facing repository catalog management command surface
- `apps/worker/scripts/`: helper scripts for Docker-backed agent execution

For multi-machine deployments, use Postgres for shared state (`JOB_REGISTRY_DB=pg` + `JOB_REGISTRY_PG_URL`).

## Agent command

- Agent command sessions run interactive coding-agent prompts with follow-ups, stop/steer controls, permission requests, and user-input questions.
- `apps/worker/src/agent-command/agentSessionRunner.ts` owns the provider-agnostic session loop and active-message routing.
- `apps/worker/src/agent-command/interactiveAgentInteractionBroker.ts` brokers Discord-facing Copilot permission and question callbacks.
- `apps/worker/src/agent-command/activeAgentPromptTurns.ts` owns generic in-memory active prompt state and the worker-managed follow-up queue.
- `apps/worker/src/codex/codexInteractiveAgent.ts` uses Codex SDK streaming for active prompts: stop aborts the active turn, while steer is worker-managed by aborting the active turn and running the steered message next.
- `apps/worker/src/codex/codexInteractionState.ts` stores Codex active turn runtime refs.
- `packages/core/src/codex/codex.ts` maps Codex agent-command profile `name` to Codex `config.profile` and exposes an abortable turn runtime through `codex.onTurnReady`.
- `apps/worker/src/opencode/openCodeInteractiveAgent.ts` uses worker-managed steer semantics: abort the active prompt, then run the steered message as the next turn.
- `apps/worker/src/opencode/openCodeInteractionState.ts` stores OpenCode active runtime refs and queued permission state.
- `apps/worker/src/copilot/copilotInteractiveAgent.ts` uses Copilot SDK session controls for active prompts: stop calls `session.abort()`, steer sends `mode: "immediate"`, and active queued follow-ups send `mode: "enqueue"`.
- `apps/worker/src/copilot/copilotInteractionState.ts` stores Copilot active session runtime handles; these handles are in-memory and only reachable by the worker currently running the prompt.
- `packages/core/src/copilot/copilot.ts` exposes active Copilot session handles through `copilot.onSessionReady` and refreshes them when a session is resumed after an idle timeout.
- For Codex, Copilot, and OpenCode agent-command profiles, explicit profile fields (`model`, `model_provider`, `reasoning_effort`) override provider defaults. When `name` selects a provider-native profile/agent, missing model-like settings should come from that provider profile/agent instead of Sniptail global default model settings.
- For Codex profiles selected by `name`, do not pass Sniptail fallback sandbox or approval defaults unless they are explicitly configured; the Codex CLI profile owns settings such as `sandbox_mode` and `approval_policy`.
- Pending agent permission/question interactions should be cleared when sessions end, fail, or stop.

## Environment

Populate `.env` from `.env.example`. Required vars are enforced in `packages/core/src/config/env.ts`.

Notable variables:

- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
- `REDIS_URL`
- `GITLAB_BASE_URL`, `GITLAB_TOKEN`
- `REPO_ALLOWLIST_PATH` (optional seed/projection JSON file; see below)
- `REPO_CACHE_ROOT`, `JOB_WORK_ROOT`, `JOB_REGISTRY_PATH`, `JOB_REGISTRY_DB`
- `LOCAL_REPO_ROOT` (optional; restricts local bootstrap paths)
- `CODEX_EXECUTION_MODE` (`local` or `docker`)
- `GH_COPILOT_EXECUTION_MODE` (`local` or `docker`)
- `OPENCODE_EXECUTION_MODE` (`local`, `server`, or `docker`)
- `CODEX_DOCKERFILE_PATH`, `CODEX_DOCKER_IMAGE`, `CODEX_DOCKER_BUILD_CONTEXT`
- `GH_COPILOT_DOCKERFILE_PATH`, `GH_COPILOT_DOCKER_IMAGE`, `GH_COPILOT_DOCKER_BUILD_CONTEXT`
- `OPENCODE_DOCKERFILE_PATH`, `OPENCODE_DOCKER_IMAGE`, `OPENCODE_DOCKER_BUILD_CONTEXT`

`REPO_ALLOWLIST_PATH` JSON shape (used to seed the DB-backed repo catalog on worker startup when the catalog is empty):

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

## Docker/agent execution

- `apps/worker/scripts/codex-docker.sh` wraps Codex in Docker and mounts requested paths.
- `apps/worker/scripts/copilot-docker.sh` wraps Copilot in Docker.
- `apps/worker/scripts/opencode-docker-server.sh` starts an OpenCode server in Docker.
- Configure the relevant execution mode (`CODEX_EXECUTION_MODE`, `GH_COPILOT_EXECUTION_MODE`, or `OPENCODE_EXECUTION_MODE`) and Docker vars in `.env` to run agent jobs in a container.
