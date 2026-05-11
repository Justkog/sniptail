---
name: sniptail-operator-install
description: 'Install and configure Sniptail for an end user without cloning the repository. Use when an agent needs to self-host Sniptail via the curl installer, set up local-first bot and worker runtime, guide Slack or Discord bot creation, configure sniptail.bot.toml and sniptail.worker.toml, and link repositories with the sniptail CLI. Also use when the user needs a split bot and worker deployment on different machines.'
argument-hint: 'Install Sniptail via curl, configure local or split deployment, enable Slack or Discord, and add repos.'
user-invocable: true
disable-model-invocation: false
---

# Sniptail Operator Install

Use this skill when the user wants an agent to install and configure Sniptail on their machine, or when the agent needs to guide a user through a first-time self-hosted setup.

This skill is designed to be fetched together with the bundled files in `./references/`.

If an agent only mirrors `SKILL.md`, it should continue with best effort, but the intended operator workflow depends on the sidecar references.

## What This Skill Does

- Installs Sniptail with the supported standalone installer instead of cloning the repository.
- Prefers the local single-process runtime with `sniptail local --migrate-if-needed` for first-time setups.
- Guides Slack or Discord bot creation and token collection.
- Configures `.env`, `sniptail.bot.toml`, and `sniptail.worker.toml`.
- Uses the `sniptail` CLI to manage linked repositories.
- Offers a split `sniptail bot` and `sniptail worker` deployment path when the user needs separate machines.

## Non-Negotiable Rules

- Do not clone the Sniptail repository unless the user explicitly asks for a source checkout.
- Prefer fetching or mirroring the full `.github/skills/sniptail-operator-install/` directory, not only `SKILL.md`.
- Use the curl installer as the default installation path:

```bash
curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh | bash
```

- Default to `sniptail local --migrate-if-needed` unless the user clearly needs bot and worker on different machines.
- Use the CLI for repository catalog management. Do not tell the user to hand-edit allowlist data unless they explicitly want that workflow.
- Ask the user which chat provider they want enabled: Slack, Discord, or both.
- Ask which coding agent runtime they want available on the worker: Codex, Copilot, OpenCode, ACP-backed agents, or a combination.

## Minimum Inputs To Collect

Collect the smallest set of facts needed to complete the setup:

1. Which chat platform should be enabled: Slack, Discord, or both?
2. Does the user want the easy local setup on one machine, or a split bot and worker deployment?
3. Which repositories should be linked, and are they GitHub, GitLab, or local paths?
4. Will the worker run agents locally from `PATH` or inside Docker?
5. Does the user need GitHub pull request support, GitLab merge request support, or clone-only access to GitLab repositories?

## Default Workflow

### 1. Verify prerequisites

Run the shared preflight checks in [Operator preflight reference](references/sniptail-preflight-reference.md) instead of relying on a verbal checklist.

Then apply the path-specific rules:

- local Codex worker:
  - require `codex --version` to succeed
- local Copilot worker:
  - require `copilot --version` to succeed
- local OpenCode worker:
  - require `opencode --version` to succeed
- ACP-backed worker:
  - require the configured ACP command to be available on the worker host
  - for `agent = "opencode"`, require `opencode --version` to succeed
  - for `agent = "copilot"`, require `copilot --version` to succeed
- Docker worker:
  - require `docker --version` to succeed
- split deployment:
  - require `REDIS_URL`
- GitLab merge request support:
  - require both `GITLAB_BASE_URL` and `GITLAB_TOKEN`
- GitHub pull request support:
  - require `GITHUB_API_TOKEN`
- Slack bot:
  - require all three `SLACK_*` values
- Discord bot:
  - require `DISCORD_BOT_TOKEN`

Important runtime fact: prebuilt Sniptail releases do not bundle fallback `codex`, `copilot`, `opencode`, or ACP preset binaries. Local and ACP-backed agent execution requires system-installed commands.

### 2. Install Sniptail

Use the supported standalone installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Justkog/sniptail/main/install.sh | bash
cp ~/.sniptail/current/.env.example ~/.sniptail/current/.env
```

Sniptail installs into `~/.sniptail/current` and links the `sniptail` CLI into `~/.local/bin` by default.

### 3. Configure the environment file

Edit `~/.sniptail/current/.env` and set only the values needed for the chosen setup.

Always consider:

- `SNIPTAIL_CHANNELS` when the user wants to force only Slack or only Discord in the bot process
- repository provider requirements from [Repository provider reference](references/sniptail-repo-providers-reference.md)
- `OPENAI_API_KEY` only when Codex needs API auth beyond existing CLI auth

For Slack setups also set:

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_SIGNING_SECRET`

For Discord setups also set:

- `DISCORD_BOT_TOKEN`

### 4. Prefer the local runtime first

For a first install on a single machine, guide the user toward:

```bash
sniptail local --migrate-if-needed
```

This local mode forces:

- `QUEUE_DRIVER=inproc`
- `JOB_REGISTRY_DB=sqlite`

That removes the need for Redis during initial setup.

### 5. Configure the chat channel

Use the provider-specific reference that matches the user request:

- Slack: [Slack operator setup](./references/sniptail-slack-operator-reference.md)
- Discord: [Discord operator setup](./references/sniptail-discord-operator-reference.md)

If the user wants both, configure both channel blocks and collect both sets of credentials.

### 6. Configure the worker runtime

Use `~/.sniptail/current/sniptail.worker.toml` to choose local, server, Docker, or ACP-backed execution for Codex, Copilot, OpenCode, or ACP-compatible agents.

Local execution:

- `[codex].execution_mode = "local"`
- `[copilot].execution_mode = "local"`
- `[opencode].execution_mode = "local"`

OpenCode server execution:

- `[opencode].execution_mode = "server"`
- set `[opencode].server_url`

ACP-backed managed jobs:

- set `[worker].primary_agent = "acp"`
- configure `[acp]`
- use `agent = "opencode"` for the built-in `opencode acp` preset
- use `agent = "copilot"` for the built-in `copilot --acp --stdio` preset
- use `command = [...]` for a custom ACP-compatible stdio agent
- note that managed ACP jobs auto-approve ACP permission prompts, while ACP form elicitations are currently for interactive `/sniptail-agent` sessions

Docker execution:

- switch the relevant execution mode to `"docker"`
- ensure Docker is installed and the Dockerfile settings are correct

### 7. Link repositories with the CLI

Use the `sniptail repos` commands instead of asking the user to edit registry data manually.

Use the provider-specific rules in [Repository provider reference](references/sniptail-repo-providers-reference.md) together with the CLI examples in [Repository catalog and CLI usage](references/sniptail-repo-catalog-reference.md).

### 8. Verify the installation

After configuration, confirm:

- the `sniptail` command is available
- the chosen channel config is enabled in `sniptail.bot.toml`
- the worker execution mode matches the available tools on the machine
- at least one repository is present in `sniptail repos list`

Then start Sniptail and test the configured provider.

## Decision Point: When To Switch To Split Deployment

Stay on the local runtime unless the user explicitly needs one of these:

- bot and worker on different machines
- Redis-backed multi-process queueing
- Postgres-backed shared job registry
- separate operational responsibilities for bot and worker hosts

If the user needs any of those, switch to the split deployment path in [Split deployment reference](references/sniptail-split-deployment-reference.md).

## High-Value Commands

Use these commands as the default operator toolbox:

```bash
sniptail local --migrate-if-needed
sniptail bot
sniptail worker
sniptail slack-manifest --name "My Bot"
sniptail repos add <repo-key> --ssh-url <ssh-url>
sniptail repos add <repo-key> --local-path <path>
sniptail repos list
sniptail repos remove <repo-key>
sniptail repos sync-file
sniptail repos sync-run-actions
sniptail db migrate --scope bot
sniptail db migrate --scope worker
```

## Recommended Agent Behavior

- Ask only the questions needed to complete the chosen path.
- Keep the user on the simplest viable install.
- Prefer editing `~/.sniptail/current/.env`, `~/.sniptail/current/sniptail.bot.toml`, and `~/.sniptail/current/sniptail.worker.toml` over inventing alternate config locations.
- If the user wants Slack, generate the manifest with `sniptail slack-manifest --name "<bot name>"` instead of hand-authoring one.
- If the user wants Discord, remind them that mention handling requires the Discord message content intent.
- If the user asks for a split deployment, explain that bot and worker must not depend on a shared filesystem.

## References

- [Operator preflight reference](references/sniptail-preflight-reference.md)
- [Standalone install and local runtime](references/sniptail-install-local-reference.md)
- [Repository provider reference](references/sniptail-repo-providers-reference.md)
- [Slack operator setup](references/sniptail-slack-operator-reference.md)
- [Discord operator setup](references/sniptail-discord-operator-reference.md)
- [Repository catalog and CLI usage](references/sniptail-repo-catalog-reference.md)
- [Split deployment reference](references/sniptail-split-deployment-reference.md)
