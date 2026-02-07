<p align="center">
  <img src="images/Sniptail_square_rounded.png" alt="Sniptail logo" width="200px" />
</p>
<p align="center">
  <strong>Bring your codebase into the conversation.</strong><br />
  <em>Or any codebase, really.</em>
</p>

Sniptail is a Slack and Discord bot that accepts slash commands, runs coding agent jobs against approved repos, and posts back reports or merge requests. It is designed for teams that want a lightweight, self-hosted automation loop for repo analysis and changes.

## Bot mention (quick demo)

You can also mention the bot directly in a channel to kick off work without remembering a slash command. This is the simplest "wow" moment: mention the bot, ask a quick question, and it will casually check the configured repositories and answer in natural language right where it was mentioned.

## Chat Commands overview

- `/sniptail-ask`: Generates a Markdown report, uploads it to Slack, and posts a completion message.
- `/sniptail-plan`: Generates a Markdown plan, uploads it to Slack, and posts a completion message.
- `/sniptail-implement`: Runs the configured coding agent to implement changes, runs checks, pushes branches, and opens GitLab MRs or GitHub PRs.
- `/sniptail-bootstrap`: Creates a GitHub/GitLab repository and appends it to the allowlist.
- `/sniptail-clear-before`: Admin-only cleanup of historical job data.
- `/sniptail-usage`: Shows Codex usage for the day/week and quota reset timing.

## Project direction

Sniptail is meant to grow along three axes: where requests come from, which coding agent executes them, and which Git service receives the results. Today it is Slack/Discord + Codex/Github_Copilot + GitHub/GitLab, but the goal is to make each layer pluggable so other platforms can be added without rewriting the whole stack.

> **Sniptail is source-available, self-hostable, and free to use and modify.**
>
> We are actively working on **Sniptail Cloud**, a hosted and managed offering for teams that want to use Sniptail without running bots, queues, or workers themselves.
>
> Sniptail Cloud is **not available yet**. If you’re interested in early access or updates, you can join the waitlist here: **[\[link\]](https://forms.gle/r5XiMVScEniHkcTVA)**


### Mediums (chat surfaces)

| Medium | Status | Notes |
| --- | --- | --- |
| Slack | Supported | Current production target |
| Discord | Supported | Current production target |
| WhatsApp | Planned | |
| Telegram | Planned | |
| Microsoft Teams | Planned | |

### Coding agents

| Agent | Status | Notes |
| --- | --- | --- |
| OpenAI Codex | Supported | SDK-backed CLI execution |
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
2. The bot queues a job in Redis and records metadata in the configured job registry (Redis recommended).
3. A worker pulls the job, prepares repo worktrees, and runs the configured coding agent (Codex or Copilot).
4. Results are posted back to Slack or Discord as a report and (for IMPLEMENT jobs) a GitLab MR or GitHub PR.

## Repo layout

Sniptail is a PNPM monorepo with two apps and one shared package:

- `apps/bot`: Slack Bolt app (Socket Mode), slash commands, Slack events
- `apps/worker`: job runner and pipeline execution
- `packages/core`: shared queue wiring, coding agent execution, Git/GitLab/GitHub integrations, config

## Dependencies

- Node.js (tested with Node 22)
- Redis (required; used for job queue and recommended job registry)
- PNPM (workspace tooling; only needed when running from source)
- Git + SSH access to your repos
- Codex CLI in `PATH` (required when `sniptail.worker.toml` sets `[codex].execution_mode = "local"`, e.g. `npm install -g @openai/codex`)
- Copilot CLI in `PATH` (required when `sniptail.worker.toml` sets `[copilot].execution_mode = "local"`, e.g. `npm install -g @github/copilot`)
- Docker (required when `[codex].execution_mode = "docker"` or `[copilot].execution_mode = "docker"`)

## Installation

### Operators / quickstart (prebuilt release + `sniptail` CLI)

This path is intended for people who want to run Sniptail, not hack on it locally. You’ll use `install.sh` + the `sniptail` CLI (no `pnpm` required).

#### 0) Install prerequisites

- Node.js
- Redis (**mandatory**)
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

#### 2) Configure Redis (URL + optional overrides)

Sniptail uses two TOML config files so the bot and worker can be run on different machines.
By default, the installer runs Sniptail with the config files located in the install root:

- `sniptail.bot.toml`
- `sniptail.worker.toml`

If you installed via `install.sh`, these live at `~/.sniptail/current/sniptail.bot.toml` and `~/.sniptail/current/sniptail.worker.toml`.

Redis is mandatory, and the defaults are set up so the **job queue** and the **job registry** use Redis.

To point Sniptail at your Redis instance, either:

- set `REDIS_URL` in your `.env` (recommended), or
- edit `redis_url` in both `sniptail.bot.toml` (`[bot].redis_url`) and `sniptail.worker.toml` (`[worker].redis_url`).

Optional: if you want the job registry to use a different Redis than the queue, set `JOB_REGISTRY_REDIS_URL` (or set `[core].job_registry_redis_url` in TOML).

If you want to keep the TOML files somewhere else (for example so upgrades don’t overwrite them), pass `--config` or set:
- `SNIPTAIL_BOT_CONFIG_PATH`
- `SNIPTAIL_WORKER_CONFIG_PATH`

#### 3) Configure environment variables

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

#### 4) Choose local vs docker agent execution

In `sniptail.worker.toml`, configure:

- `[codex].execution_mode = "local"` or `"docker"`
- `[copilot].execution_mode = "local"` or `"docker"`

When using `"local"`, install the corresponding CLI (`codex` / `copilot`) so it’s available in `PATH`. When using `"docker"`, ensure Docker is available and configure the relevant docker settings in the TOML.

#### 5) Slack / Discord setup

See `docs/slack-bot-setup.md` and `docs/discord-bot-setup.md`.

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

#### 7) Run bot + worker

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

#### 2) Configure Redis + job registry backend

Redis is still mandatory (queue). For the job registry, you can:

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

When `[codex].execution_mode = "docker"` or `[copilot].execution_mode = "docker"`, you can point the worker at non-default Dockerfiles (instead of `./Dockerfile.codex` and `./Dockerfile.copilot`) by setting:

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
- Only repos listed in the DB-backed repo catalog are selectable in Slack/Discord.
- GitHub repos require `GITHUB_API_TOKEN`; GitLab repos require `projectId` plus `GITLAB_TOKEN`.

## License

Sniptail is licensed under the Elastic License v2.

You are free to:
- Use Sniptail for personal or internal business purposes
- Self-host Sniptail
- Modify the source code
- Distribute unmodified or modified copies

You may not:
- Offer Sniptail as a hosted or managed service to third parties
- Provide Sniptail as part of a commercial SaaS offering without permission

If you are interested in a hosted or managed version, see Sniptail Cloud.


## Sniptail Cloud (Hosted & Managed)

We are building **Sniptail Cloud**, a hosted and managed version of Sniptail for teams that want the benefits of Sniptail without operating the underlying infrastructure.

Sniptail Cloud is intended to provide:

- A **hosted Slack / Discord bot**
- Managed job coordination (queues, state, retries)
- A web dashboard for configuration, usage, and history
- Optional **fully managed workers** (no servers to run)
- Upgrades, monitoring, and operational reliability handled for you

Sniptail Cloud is currently under active development and is **not yet publicly available**.

### Source-available vs Cloud

Sniptail is designed to be usable in multiple ways.

- The **core Sniptail engine** (bot, worker, agents, integrations) is source-available, self-hostable, and free to use and modify under the Elastic License v2.
- **Sniptail Cloud** (in development) will add a managed control plane, hosted bots, and optional managed execution.

When Sniptail Cloud becomes available, teams will be able to:
- self-host everything
- use a hosted bot while running their own workers
- or use a fully managed setup with no self-hosted components

Self-hosting will remain a supported and valid way to run Sniptail.

### Starting Open, Moving to Cloud (Later)

Many teams may start by self-hosting Sniptail and later look for ways to reduce operational overhead.

Sniptail Cloud is being designed to make that transition straightforward:
- configurations and repo allowlists will map directly
- workflows and chat commands will stay the same
- moving to Cloud will not require changes to how your team uses Sniptail day to day

Using Sniptail Cloud will be optional.

## FAQ

**Is Sniptail Cloud available today?**  
No. Sniptail Cloud is currently under development.

**Do I need Sniptail Cloud to use Sniptail?**  
No. Sniptail is fully usable as a self-hosted, source-available tool.

**Will the source-available version be limited in the future?**  
No. The core Sniptail engine will remain source-available. Sniptail Cloud focuses on hosting, orchestration, and operational convenience.

**Why mention Sniptail Cloud now?**  
To be transparent about the project’s direction and to gather early feedback from teams interested in a managed offering.

---

Interested in a hosted or managed version of Sniptail?  
👉 **Join the Sniptail Cloud waitlist:** **[\[link\]](https://forms.gle/r5XiMVScEniHkcTVA)**
