# Sniptail Install And Local Runtime Reference

This reference covers the preferred first-time setup path: install Sniptail with the standalone installer, configure the environment file, and start the app in local mode.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh | bash
cp ~/.sniptail/current/.env.example ~/.sniptail/current/.env
```

Result:

- Sniptail is installed under `~/.sniptail/current`
- the `sniptail` CLI is linked into `~/.local/bin`
- no repository clone is required

## Preflight Checks

Run the shared checks in [Operator preflight reference](./sniptail-preflight-reference.md).

For the local runtime, interpret them conservatively:

- local Codex execution requires `codex --version` to succeed
- local Copilot execution requires `copilot --version` to succeed
- local OpenCode execution requires `opencode --version` to succeed
- ACP preset execution requires the preset command to succeed (`opencode --version` for `agent = "opencode"`, `copilot --version` for `agent = "copilot"`)
- custom ACP execution requires the configured stdio command to be available
- Docker execution requires `docker --version` to succeed
- repository linking requires `git ls-remote <ssh-url> HEAD` to succeed for each remote repository

If the chosen execution mode or repository access check fails, stop and fix that dependency before continuing.

## Core Environment Values

The environment file is `~/.sniptail/current/.env`.

Common values:

- `SNIPTAIL_CHANNELS=` to force only Slack, only Discord, or both
- `QUEUE_DRIVER=` only when overriding the default runtime path
- `REDIS_URL=` only when using Redis queue transport
- provider-specific variables from [Repository provider reference](./sniptail-repo-providers-reference.md)
- `OPENAI_API_KEY=` only when Codex needs API auth beyond existing CLI login
- `SNIPTAIL_DEBUG=` for namespace-based debug logging

Provider credentials:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
- Discord: `DISCORD_BOT_TOKEN`

## Local Runtime

Preferred first run:

```bash
sniptail local --migrate-if-needed
```

Why this is preferred:

- runs bot and worker in one process
- uses in-process queue transport
- uses sqlite for the job registry
- does not require Redis for the first successful install

The local command automatically forces:

- `QUEUE_DRIVER=inproc`
- `JOB_REGISTRY_DB=sqlite`

## Config Files To Review

- `~/.sniptail/current/sniptail.bot.toml`
- `~/.sniptail/current/sniptail.worker.toml`

Typical first edits:

- enable Slack and or Discord under `[channels.*]`
- set Discord `app_id` when Discord is enabled
- choose `[codex].execution_mode`, `[copilot].execution_mode`, and `[opencode].execution_mode`
- configure `[worker].primary_agent = "acp"` plus `[acp]` when using ACP-backed managed jobs

## Worker Execution Modes

Local mode:

- requires system `codex`, `copilot`, or `opencode` binaries in `PATH`

ACP-backed mode:

- set `[worker].primary_agent = "acp"` for managed jobs
- configure `[acp]` with `agent = "opencode"`, `agent = "copilot"`, or an explicit `command = [...]`
- requires the configured ACP command or preset CLI in `PATH`
- managed ACP jobs auto-approve ACP permission prompts; ACP form elicitations are currently for interactive `/sniptail-agent` sessions

OpenCode server mode:

- requires `[opencode].execution_mode = "server"`
- requires `[opencode].server_url` to point at a reachable OpenCode server

Docker mode:

- requires Docker
- uses the configured Dockerfile and image settings in `sniptail.worker.toml`

## Repository Providers

Use [Repository provider reference](./sniptail-repo-providers-reference.md) for GitHub and GitLab requirements, including clone-only access versus PR or MR support.

## First Verification Checklist

- `sniptail --version` works
- the chosen provider credentials are present in `.env`
- the relevant channel block is enabled in `sniptail.bot.toml`
- the desired agent execution mode is set in `sniptail.worker.toml`
- the user can start the local runtime without configuration errors
