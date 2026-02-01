<p align="center">
  <img src="images/Sniptail_square_rounded.png" alt="Sniptail logo" width="200px" />
</p>

Sniptail is a Slack and Discord bot that accepts slash commands, runs coding agent jobs against approved repos, and posts back reports or merge requests. It is designed for teams that want a lightweight, self-hosted automation loop for repo analysis and changes.

## Project direction

Sniptail is meant to grow along three axes: where requests come from, which coding agent executes them, and which Git service receives the results. Today it is Slack/Discord + Codex/Github_Copilot + GitHub/GitLab, but the goal is to make each layer pluggable so other platforms can be added without rewriting the whole stack.

### Mediums (chat surfaces)

| Medium | Status | Notes |
| --- | --- | --- |
| Slack | Supported | Current production target |
| Discord | Supported | |
| WhatsApp | Planned | |
| Telegram | Planned | |
| Microsoft Teams | Planned | |

### Coding agents

| Agent | Status | Notes |
| --- | --- | --- |
| OpenAI Codex | Supported | Current execution engine |
| GitHub Copilot CLI | Supported | SDK-backed CLI execution |
| Claude Code | Planned | |
| OpenCode | Planned | |
| Gemini CLI | Planned | |
| Aider | Planned | |

### Git services

| Service | Status | Notes |
| --- | --- | --- |
| GitHub | Supported | PR creation supported |
| GitLab | Supported | MR creation supported |
| Bitbucket | Planned | |
| Azure DevOps | Planned | |
| Gitea / Forgejo | Planned | |

## How it works (high level)

1. A user triggers a slash command or mentions the bot in Slack or Discord.
2. The bot queues a job in Redis and records metadata in a local job registry.
3. A worker pulls the job, prepares repo worktrees, and runs the configured coding agent (Codex or Copilot).
4. Results are posted back to Slack or Discord as a report and (for IMPLEMENT jobs) a GitLab MR or GitHub PR.

## Repo layout

Sniptail is a PNPM monorepo with two apps and one shared package:

- `apps/bot`: Slack Bolt app (Socket Mode), slash commands, Slack events
- `apps/worker`: job runner and pipeline execution
- `packages/core`: shared queue wiring, coding agent execution, Git/GitLab/GitHub integrations, config

## Dependencies

- Node.js (tested with Node 22)
- PNPM (workspace tooling)
- Redis (for job queue)
- Git + SSH access to your repos
- Codex CLI in `PATH` (required when `sniptail.worker.toml` sets `[codex].execution_mode = "local"`, e.g. `npm install -g @openai/codex`)
- Copilot CLI in `PATH` (required when `sniptail.worker.toml` sets `[copilot].execution_mode = "local"`, e.g. `npm install -g @github/copilot`)
- Docker (required when `[codex].execution_mode = "docker"` or `[copilot].execution_mode = "docker"`)

## Installation (step by step)

### 1) Install and run dependencies

- Install Node.js, Redis, Git, and SSH keys for repo access.
- If using `sniptail.worker.toml` `[codex].execution_mode = "local"`, install the Codex CLI so `codex` is available in `PATH`.
- If using `[codex].execution_mode = "docker"`, install and run Docker.

### 2) Create a repo allowlist

Create a JSON file (ex: `repo-allowlist.json`) and set `repo_allowlist_path` in both `sniptail.bot.toml` and `sniptail.worker.toml` under the `[core]` section. The keys are short repo names that users select in Slack. You can override the path with `REPO_ALLOWLIST_PATH` if needed.

```json
{
  "sniptail": {
    "sshUrl": "git@gitlab.com:your-group/sniptail.git",
    "projectId": 123456,
    "baseBranch": "main"
  },
  "local-tools": {
    "localPath": "/srv/repos/local-tools",
    "baseBranch": "main"
  },
  "docs-site": {
    "sshUrl": "git@github.com:your-org/docs-site.git",
    "baseBranch": "main"
  }
}
```

Notes:
- Use `sshUrl` or `localPath` for every entry.
- `localPath` points at a local repo source on the same machine.
- `projectId` is required for GitLab merge requests.
- `baseBranch` is optional; it is used as the default branch in Slack modals.

### 3) Configure TOML files

Sniptail uses two TOML config files so the bot and worker can be run on different machines.

Default paths:
- `./sniptail.bot.toml`
- `./sniptail.worker.toml`

Override paths with env vars:
- `SNIPTAIL_BOT_CONFIG_PATH`
- `SNIPTAIL_WORKER_CONFIG_PATH`

The bot file holds chat-surface settings (Slack/Discord enablement, `bot_name`, `bootstrap_services`, `redis_url`, and shared `[core]` paths). The worker file holds execution and repo settings (coding agent execution modes for Codex/Copilot, repo cache/work roots, GitHub/GitLab base URLs, and shared `[core]` paths).

Each agent can still be fully customized (skills, MCP servers, and more) by inheriting the home or repository configurations.

### 4) Configure environment variables

Required (secrets):
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN` (Socket Mode app-level token)
- `SLACK_SIGNING_SECRET`
- `DISCORD_BOT_TOKEN` (if Discord is enabled)

Worker secrets:
- `OPENAI_API_KEY` (required in practice for Codex execution)
- `GITLAB_TOKEN` (required for GitLab merge requests)
- `GITHUB_API_TOKEN` (required to create GitHub PRs)
- `JOB_REGISTRY_PG_URL` (required only when using Postgres registry)

Optional:
- `SNIPTAIL_DRY_RUN` (`1` runs a smoke test and exits without connecting to Slack or Redis)
- `LOCAL_REPO_ROOT` (optional; when set, local bootstrap paths are relative to this root)

### 5) Choose local vs docker Codex execution

- `[codex].execution_mode = "local"`
  - Runs Codex directly on the host.
  - Requires `@openai/codex` available in `PATH` and local tooling installed.
- `[codex].execution_mode = "docker"`
  - Runs Codex inside a container via `scripts/codex-docker.sh`.
  - Useful for consistent tooling and sandboxed execution.
  - Adds extra security isolation as long as the agent is not explicitly trying to jailbreak out of the container.
  - Configure `[codex].dockerfile_path`, `[codex].docker_image`, and `[codex].docker_build_context` if you want the image to auto-build.

### 5b) Choose local vs docker Copilot execution

- `[copilot].execution_mode = "local"`
  - Runs Copilot CLI directly on the host.
  - Requires `@github/copilot` available in `PATH`.
- `[copilot].execution_mode = "docker"`
  - Runs Copilot CLI inside a container via `apps/worker/scripts/copilot-docker.sh`.
  - Adds extra security isolation as long as the agent is not explicitly trying to jailbreak out of the container.
  - Configure `[copilot].dockerfile_path`, `[copilot].docker_image`, and `[copilot].docker_build_context` if you want the image to auto-build.

### 6) Slack app setup

Create a Slack app (Socket Mode enabled) and add the following manifest (edit the name if desired). The slash commands are derived from `sniptail.bot.toml` `[bot].bot_name` (default prefix is `sniptail`).

To generate the manifest automatically, run:

```bash
node scripts/generate-slack-manifest.mjs "My Bot"
```

This uses `scripts/slack-app-manifest.template.yaml` and writes `slack-app-manifest.yaml` in the repo root. If you prefer, set `[bot].bot_name` in `sniptail.bot.toml` and omit the argument.

```yaml
display_information:
  name: sniptail
features:
  bot_user:
    display_name: Sniptail
    always_online: true
  slash_commands:
    - command: /sniptail-ask
      description: Ask Sniptail to analyze one or more repos and return a Markdown report.
      usage_hint: "[repo keys] [branch] [request text]"
      should_escape: false
    - command: /sniptail-plan
      description: Ask Sniptail to plan a feature implementation across one or more repos.
      usage_hint: "[repo keys] [branch] [request text]"
      should_escape: false
    - command: /sniptail-implement
      description: Ask Sniptail to implement changes, run checks, and open GitLab MRs.
      usage_hint: "[repos] [branch]"
      should_escape: false
    - command: /sniptail-bootstrap
      description: Create a new repository and add it to the allowlist.
      should_escape: false
    - command: /sniptail-clear-before
      description: Ask Sniptail to clear jobs data created before a certain date
      should_escape: false
    - command: /sniptail-usage
      description: shows your current Codex usage for the day and week, plus when each quota resets.
      should_escape: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - commands
      - files:write
      - groups:history
      - groups:read
      - im:history
      - im:write
      - mpim:history
      - reactions:write
settings:
  event_subscriptions:
    bot_events:
      - app_mention
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

After installing the app to your workspace, set:
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_SIGNING_SECRET`

### 7) Run the bot

```bash
pnpm install
pnpm run dev
```

For production:

```bash
pnpm run build
pnpm run start
```

## Command overview

- `/sniptail-ask`: Generates a Markdown report, uploads it to Slack, and posts a completion message.
- `/sniptail-plan`: Generates a Markdown plan, uploads it to Slack, and posts a completion message.
- `/sniptail-implement`: Runs the configured coding agent to implement changes, runs checks, pushes branches, and opens GitLab MRs or GitHub PRs.
- `/sniptail-bootstrap`: Creates a GitHub/GitLab repository and appends it to the allowlist.
- `/sniptail-clear-before`: Admin-only cleanup of historical job data.
- `/sniptail-usage`: Shows Codex usage for the day/week and quota reset timing.

## Repo execution notes

- Repos are mirrored into `[worker].repo_cache_root` and checked out as worktrees under `[core].job_work_root` from `sniptail.worker.toml`.
- Only repos listed in the allowlist are selectable in Slack.
- GitHub repos require `GITHUB_API_TOKEN`; GitLab repos require `projectId` plus `GITLAB_TOKEN`.

## Key paths

- `apps/bot/src/index.ts`: Slack app bootstrap (Socket Mode)
- `apps/worker/src/index.ts`: worker bootstrap
- `packages/core/src/slack/`: Slack commands, modals, and event handlers
- `packages/core/src/queue/`: BullMQ queue wiring
- `packages/core/src/git/`: Git operations and repo management
- `packages/core/src/codex/`: Codex SDK integration and execution
- `packages/core/src/config/env.ts`: env var schema + validation
- `scripts/`: helper scripts (notably `scripts/codex-docker.sh`)
