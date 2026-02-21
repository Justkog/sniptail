# Setup and Operations

## Repo layout

Sniptail is a PNPM monorepo with two apps and two shared packages:

- `apps/bot`: Slack Bolt app (Socket Mode), slash commands, Slack events
- `apps/worker`: job runner and pipeline execution
- `packages/core`: shared queue wiring, coding agent execution, Git/GitLab/GitHub integrations, config
- `packages/cli`: `sniptail` command entrypoint and runtime command launcher

## Dependencies

- Node.js (tested with Node 22)
- Redis (required only when `[core].queue_driver = "redis"`)
- PNPM (workspace tooling; only needed when running from source)
- Git + SSH access to your repos
- Codex CLI in `PATH` (required when `sniptail.worker.toml` sets `[codex].execution_mode = "local"`, e.g. `npm install -g @openai/codex`)
- Copilot CLI in `PATH` (required when `sniptail.worker.toml` sets `[copilot].execution_mode = "local"`, e.g. `npm install -g @github/copilot`)
- Docker (required when `[codex].execution_mode = "docker"` or `[copilot].execution_mode = "docker"`)

## Installation

### Operators (prebuilt release + `sniptail` CLI)

This path is intended for people who want to run Sniptail, not hack on it locally. You'll use `install.sh` + the `sniptail` CLI (no `pnpm` required).

#### 0) Install prerequisites

- Node.js
- Redis (required only when using `queue_driver = "redis"`)
- Git + SSH access to your repos (worker needs this)
- One of:
  - Codex/Copilot CLI in `PATH` (when using `execution_mode = "local"`), or
  - Docker (when using `execution_mode = "docker"`)

#### 1) Install Sniptail (`install.sh`)

Use the one-liner installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh | bash
```

This installs into `~/.sniptail` and links the CLI into `~/.local/bin`.

#### 2) Configure environment variables

Start from `.env.example` (from the repo, or `~/.sniptail/current/.env.example` if you installed via `install.sh`) and set at least:

```bash
cp ~/.sniptail/current/.env.example ~/.sniptail/current/.env
```

- Slack (only if enabled):
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN` (Socket Mode app-level token)
  - `SLACK_SIGNING_SECRET`
- Discord (only if enabled):
  - `DISCORD_BOT_TOKEN`
- Worker (required in practice for most setups):
  - `GITLAB_TOKEN` (for GitLab merge requests)
  - `GITHUB_API_TOKEN` (for GitHub PR creation)

#### 3) Choose queue transport (inproc or redis)

Sniptail uses two TOML config files so the bot and worker can be run on different machines.
By default, the installer runs Sniptail with the config files located in the install root:

- `sniptail.bot.toml`
- `sniptail.worker.toml`

If you installed via `install.sh`, these live at `~/.sniptail/current/sniptail.bot.toml` and `~/.sniptail/current/sniptail.worker.toml`.

Queue transport defaults to Redis (`[core].queue_driver = "redis"`).

For single-machine mode without Redis queueing, use:

- `sniptail local` command
- `QUEUE_DRIVER=inproc`
- `JOB_REGISTRY_DB=sqlite` (durable local job registry)

For distributed mode, keep Redis queue transport:

- set `QUEUE_DRIVER=redis` (or `[core].queue_driver = "redis"`), then configure `REDIS_URL`:

- set `REDIS_URL` in your `.env` (recommended), or
- edit `redis_url` in both `sniptail.bot.toml` (`[bot].redis_url`) and `sniptail.worker.toml` (`[worker].redis_url`).

Optional: if you want the job registry to use a different Redis than the queue, set `JOB_REGISTRY_REDIS_URL` (or set `[core].job_registry_redis_url` in TOML).

If you want to keep the TOML files somewhere else (for example so upgrades don't overwrite them), pass `--config` or set:
- `SNIPTAIL_BOT_CONFIG_PATH`
- `SNIPTAIL_WORKER_CONFIG_PATH`

#### 4) Choose local vs docker agent execution

In `sniptail.worker.toml`, configure:

- `[codex].execution_mode = "local"` or `"docker"`
- `[copilot].execution_mode = "local"` or `"docker"`

When using `"local"`, install the corresponding CLI (`codex` / `copilot`) so it's available in `PATH`. When using `"docker"`, ensure Docker is available and configure the relevant docker settings in the TOML.

#### 5) Slack / Discord setup

See `docs/slack-bot-setup.md` and `docs/discord-bot-setup.md`.

Enable channels in `sniptail.bot.toml` using the channel section:

```toml
[channels.slack]
enabled = true

[channels.discord]
enabled = true
app_id = "123456789012345678"
```

For single-channel bot processes, set `SNIPTAIL_CHANNELS` at runtime (for example `SNIPTAIL_CHANNELS=slack` or `SNIPTAIL_CHANNELS=discord`).

To generate a Slack manifest from the template:

```bash
sniptail slack-manifest --name "My Bot"
```

This uses `scripts/slack-app-manifest.template.yaml` and writes `slack-app-manifest.yaml` in the current directory.

#### 6) Seed the repository catalog

The repo allowlist is stored in the configured job registry backend (sqlite/pg/redis). With the default Redis registry, this also means bot + worker can run on different machines without any shared filesystem.

The quickest way to seed entries is with the CLI:

```bash
sniptail repos add my-api --ssh-url git@github.com:org/my-api.git
sniptail repos add payments --ssh-url git@gitlab.com:org/payments.git --project-id 12345
sniptail repos add local-tools --local-path /srv/repos/local-tools
sniptail repos list
```

You can also seed from a JSON file by setting `repo_allowlist_path` in `sniptail.worker.toml` `[core]` (or `REPO_ALLOWLIST_PATH` in env). On worker startup, Sniptail seeds the registry catalog when it is empty.

Example allowlist JSON:

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
- `baseBranch` is optional; it is used as the default branch behind the scene.

To reconcile the registry catalog back into the allowlist file:

```bash
sniptail repos sync-file
```

#### 7) Run runtimes

Single-machine local mode:

```bash
sniptail local
```

Distributed/separate processes:

```bash
sniptail bot
sniptail worker
```

### Developers / contributors (clone the repo)

This path is intended for local development and contributions.

#### 1) Clone and install

```bash
git clone git@github.com:Justkog/sniptail.git
cd sniptail
pnpm install
cp .env.example .env
```

#### 2) Configure queue transport + job registry backend

For queue transport:

- use Redis (`[core].queue_driver = "redis"`) for multi-process/multi-machine setups, or
- use in-process (`[core].queue_driver = "inproc"`) for single-machine `sniptail local` runs.

For the job registry, you can:

- use the same Redis instance (recommended, set `[core].job_registry_db = "redis"`), or
- use sqlite for single-machine/local experiments (`[core].job_registry_db = "sqlite"`), or
- use Postgres for shared state (`[core].job_registry_db = "pg"` + `JOB_REGISTRY_PG_URL`)

#### 3) Postgres migrations (optional)

If you use Postgres for the job registry, apply migrations:

```bash
pnpm run db:migrate:pg
```

#### 4) Run in dev

```bash
pnpm run dev
```

#### 5) Build + run (production)

```bash
pnpm run build
pnpm run start
```

#### 6) Custom Dockerfiles (optional)

When `[codex].execution_mode = "docker"` or `[copilot].execution_mode = "docker"`, you can point the worker at non-default Dockerfiles (instead of the defaults `../../Dockerfile.codex` and `../../Dockerfile.copilot`, resolved from the worker app directory) by setting:

- `sniptail.worker.toml`: `[codex].dockerfile_path` / `[copilot].dockerfile_path` (plus optional `docker_image` and `docker_build_context`), or
- env vars (override TOML): `CODEX_DOCKERFILE_PATH`, `CODEX_DOCKER_IMAGE`, `CODEX_DOCKER_BUILD_CONTEXT`, `GH_COPILOT_DOCKERFILE_PATH`, `GH_COPILOT_DOCKER_IMAGE`, `GH_COPILOT_DOCKER_BUILD_CONTEXT`

#### 7) Use installed CLI against a local checkout (optional)

You can still use the installed CLI against your local checkout by pointing it at your config and env files.

#### 8) Installer overrides (optional)

Advanced installer options (useful for testing or forks):

```bash
SNIPTAIL_REPO=your-org/sniptail curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh | bash
SNIPTAIL_VERSION=vX.Y.Z curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh -o install.sh
chmod +x ./install.sh
SNIPTAIL_TARBALL=/path/to/sniptail-vX.Y.Z-linux-x64.tar.gz ./install.sh
```

## Repo execution notes

- Repos are mirrored into `[worker].repo_cache_root` and checked out as worktrees under `[core].job_work_root` from `sniptail.worker.toml`.
- Worker parallelism is configurable per queue via `[worker].job_concurrency`, `[worker].bootstrap_concurrency`, and `[worker].worker_event_concurrency` (or env overrides `JOB_CONCURRENCY`, `BOOTSTRAP_CONCURRENCY`, `WORKER_EVENT_CONCURRENCY`), each defaulting to `2`.
- Worktree bootstrap is optional and configurable. Set `[worker].worktree_setup_command` (or `WORKTREE_SETUP_COMMAND`) to run a custom command in each worktree (for example `pnpm install`, `npm ci`, `poetry install`, etc.).
- Repos can define a local setup contract script at `.sniptail/setup` (no extension). If present, it runs in the repo worktree after `worktree_setup_command`.
- Repos can define a local check contract script at `.sniptail/check` (no extension). If present, it runs during validation before configured check aliases.
- Contract scripts must be executable (`chmod +x .sniptail/setup .sniptail/check`), and non-zero exits fail the job.
- To continue a job even when the setup command fails, set `[worker].worktree_setup_allow_failure = true` (or `WORKTREE_SETUP_ALLOW_FAILURE=true`).
- Only repos listed in the DB-backed repo catalog are selectable in Slack/Discord.
- GitHub repos require `GITHUB_API_TOKEN`; GitLab repos require `projectId` plus `GITLAB_TOKEN`.
