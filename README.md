# Sniptail

Sniptail is a Slack bot that accepts slash commands, runs Codex jobs against approved repos, and posts back reports or merge requests. It is designed for teams that want a lightweight, self-hosted automation loop for repo analysis and changes.

## How it works (high level)

1. A user triggers a slash command or mentions the bot in Slack.
2. The bot queues a job in Redis and records metadata in a local job registry.
3. A worker pulls the job, prepares repo worktrees, and runs Codex with the request.
4. Results are posted back to Slack as a report and (for IMPLEMENT jobs) a GitLab MR or GitHub PR.

## Dependencies

- Node.js (tested with Node 22)
- Redis (for job queue)
- Git + SSH access to your repos
- Docker (optional, for running Codex in container mode)

## Setup

### 1) Create a repo allowlist

Create a JSON file (ex: `repo-allowlist.json`) and point `REPO_ALLOWLIST_PATH` to it. The keys are short repo names that users select in Slack.

```json
{
  "sniptail": {
    "sshUrl": "git@gitlab.com:your-group/sniptail.git",
    "projectId": 123456,
    "baseBranch": "main"
  },
  "docs-site": {
    "sshUrl": "git@github.com:your-org/docs-site.git",
    "baseBranch": "main"
  }
}
```

Notes:
- `sshUrl` is required for every entry.
- `projectId` is required for GitLab merge requests.
- `baseBranch` is optional; it is used as the default branch in Slack modals.

### 2) Configure environment variables

Required:
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN` (Socket Mode app-level token)
- `SLACK_SIGNING_SECRET`
- `REDIS_URL`
- `REPO_ALLOWLIST_PATH`
- `REPO_CACHE_ROOT` (path where bare mirrors are stored)
- `JOB_WORK_ROOT` (path where job worktrees + artifacts live)
- `JOB_REGISTRY_PATH` (path for job registry LevelDB)

Optional:
- `OPENAI_API_KEY` (required in practice for Codex execution)
- `BOT_NAME` (defaults to `Sniptail`; also controls slash command prefix)
- `ADMIN_USER_IDS` (comma-separated user IDs allowed to run clear-before)
- `JOB_ROOT_COPY_GLOB` (glob of files/folders to seed into each job root)
- `GITLAB_BASE_URL` (required for GitLab merge requests)
- `GITLAB_TOKEN` (required for GitLab merge requests)
- `GITHUB_TOKEN` (required to create GitHub PRs)
- `GITHUB_API_BASE_URL` (defaults to `https://api.github.com`)
- `CODEX_EXECUTION_MODE` (`local` or `docker`)
- `CODEX_DOCKERFILE_PATH` (path to a Dockerfile for Codex)
- `CODEX_DOCKER_IMAGE` (image name to use/build)
- `CODEX_DOCKER_BUILD_CONTEXT` (optional build context path)
- `CODEX_DOCKER_HOST_HOME` (optional; defaults to host home dir)

### 3) Choose local vs docker Codex execution

- `CODEX_EXECUTION_MODE=local`
  - Runs Codex directly on the host.
  - Requires `@openai/codex` available in `PATH` and local tooling installed.
- `CODEX_EXECUTION_MODE=docker`
  - Runs Codex inside a container via `scripts/codex-docker.sh`.
  - Useful for consistent tooling and sandboxed execution.
  - Configure `CODEX_DOCKERFILE_PATH`, `CODEX_DOCKER_IMAGE`, and `CODEX_DOCKER_BUILD_CONTEXT` if you want the image to auto-build.

### 4) Slack app setup

Create a Slack app (Socket Mode enabled) and add the following manifest (edit the name if desired). The slash commands are derived from `BOT_NAME` (default prefix is `sniptail`).

```yaml
display_information:
  name: Snatch
features:
  bot_user:
    display_name: Snatchy
    always_online: true
  slash_commands:
    - command: /snatchy-ask
      description: Ask Snatchy to analyze one or more repos and return a Markdown report.
      usage_hint: "[repo keys] [branch] [request text]"
      should_escape: false
    - command: /snatchy-implement
      description: Ask Snatchy to implement changes, run checks, and open GitLab MRs.
      usage_hint: "[repos] [branch]"
      should_escape: false
    - command: /snatchy-clear-before
      description: Ask Snatchy to clear jobs data created before a certain date
      should_escape: false
    - command: /snatchy-usage
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

### 5) Run the bot

```bash
npm install
npm run dev
```

For production:

```bash
npm run build
npm run start
```

## Command overview

- `/sniptail-ask`: Generates a Markdown report, uploads it to Slack, and posts a completion message.
- `/sniptail-implement`: Runs Codex to implement changes, runs checks, pushes branches, and opens GitLab MRs or GitHub PRs.
- `/sniptail-clear-before`: Admin-only cleanup of historical job data.
- `/sniptail-usage`: Shows Codex usage for the day/week and quota reset timing.

## Repo execution notes

- Repos are mirrored into `REPO_CACHE_ROOT` and checked out as worktrees under `JOB_WORK_ROOT`.
- Only repos listed in the allowlist are selectable in Slack.
- GitHub repos require `GITHUB_TOKEN`; GitLab repos require `projectId` plus `GITLAB_TOKEN`.
