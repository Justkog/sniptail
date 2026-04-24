# Sniptail Operator Preflight Reference

Use this reference before installation or runtime bring-up when an agent needs to verify that a machine is ready for Sniptail.

## Scope

This reference centralizes the raw checks.

Keep path-specific policy in the local and split deployment references:

- local mode does not require `REDIS_URL`
- split mode requires `REDIS_URL`
- GitLab clone-only does not require GitLab API variables
- GitLab merge request support requires `GITLAB_BASE_URL` and `GITLAB_TOKEN`

## Base Checks

Run these on every machine where Sniptail will be installed or operated:

```bash
command -v curl >/dev/null
command -v git >/dev/null
```

## Worker Runtime Checks

Run these on the worker host:

```bash
codex --version >/dev/null 2>&1 || true
copilot --version >/dev/null 2>&1 || true
opencode --version >/dev/null 2>&1 || true
docker --version >/dev/null 2>&1 || true
```

Interpretation:

- use local Codex execution only when `codex --version` succeeds
- use local Copilot execution only when `copilot --version` succeeds
- use local OpenCode execution only when `opencode --version` succeeds
- use Docker execution only when `docker --version` succeeds

## Repository Access Checks

For each remote repository that will be linked on the worker:

```bash
git ls-remote <ssh-url> HEAD
```

Interpretation:

- repository linking requires `git ls-remote <ssh-url> HEAD` to succeed
- if this check fails, stop and fix SSH access before continuing

## Integration Environment Checks

Run only the checks required for the enabled features:

```bash
test -n "$SLACK_BOT_TOKEN"
test -n "$SLACK_APP_TOKEN"
test -n "$SLACK_SIGNING_SECRET"
test -n "$DISCORD_BOT_TOKEN"
test -n "$GITHUB_API_TOKEN"
test -n "$GITLAB_BASE_URL"
test -n "$GITLAB_TOKEN"
test -n "$REDIS_URL"
```

Interpretation:

- Slack bot requires all three `SLACK_*` values
- Discord bot requires `DISCORD_BOT_TOKEN`
- GitHub pull request support requires `GITHUB_API_TOKEN`
- GitLab merge request support requires both `GITLAB_BASE_URL` and `GITLAB_TOKEN`
- split deployment requires `REDIS_URL`

## Post-Install Layout Checks

Run these after the installer completes:

```bash
test -x "$HOME/.local/bin/sniptail"
test -f "$HOME/.sniptail/current/.env.example"
test -f "$HOME/.sniptail/current/sniptail.bot.toml"
test -f "$HOME/.sniptail/current/sniptail.worker.toml"
```

Interpretation:

- if any of these checks fail, the install is incomplete or the expected install root differs from the default

## Failure Policy

- If a required check fails, stop and fix that dependency before continuing.
- Do not continue on a guessed-good setup.
- Prefer switching execution mode over hand-waving a missing dependency:
  - missing local `codex`, `copilot`, or `opencode` -> switch to Docker or install the CLI
  - missing `REDIS_URL` in a simple single-machine setup -> prefer `sniptail local`
  - missing GitLab API variables for clone-only use -> continue without merge request support
