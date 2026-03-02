# Run Actions Setup (Bot + Worker + Repo Contracts)

This guide explains how to configure run actions end-to-end so `/...-run` works in Slack/Discord and executes correctly on workers.

## How run actions are resolved

A run action is available and runnable only when all three layers align:

1. Bot config (`sniptail.bot.toml`) defines UI-facing action entries (`label`, `description`).
2. Worker config (`sniptail.worker.toml`) defines execution behavior (`fallback_command`, timeout, git mode, checks).
3. Repository metadata contains the action ID (usually from `.sniptail/run/<action-id>` plus optional `.params.toml` sidecar, synced into the catalog).

At runtime, the bot shows the intersection of:

- action IDs configured in bot config, and
- action IDs available on every selected repo in catalog metadata.

## 1) Bot configuration (`sniptail.bot.toml`)

Define run actions under `[run.actions]`.

```toml
[run.actions.deploy-preview]
label = "Deploy Preview"
description = "Run preview deploy flow"

[run.actions."db-migration-sanity"]
label = "DB migration sanity"
description = "Validate migration metadata"
```

Notes:

- Action IDs are normalized to lowercase and must match `^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$`.
- Bot config is display/catalog intent only. It does not define execution commands.
- If an action is in bot config but missing from selected repos' metadata, users will not see it for those repos.

## 2) Worker configuration (`sniptail.worker.toml`)

Define execution options under `[run.actions]`.

```toml
[run.actions.deploy-preview]
timeout_ms = 120000
allow_failure = false
git_mode = "execution-only"
fallback_command = ["pnpm", "run", "deploy:preview"]

[run.actions."db-migration-sanity"]
timeout_ms = 300000
allow_failure = false
git_mode = "execution-only"
```

Supported fields:

- `fallback_command` (optional): used only when repo contract `.sniptail/run/<action-id>` is missing.
- `timeout_ms` (optional, default `600000`).
- `allow_failure` (optional, default `false`).
- `git_mode` (optional):
  - `execution-only` (default): run command only.
  - `implement`: publish repo changes (commit/push + PR/MR flow), and optionally run `checks`.
- `checks` (optional): check aliases used when `git_mode = "implement"`.

Important:

- A worker entry for the action ID is required. If missing, the job fails.
- Contract script has precedence over `fallback_command`.
- If contract is missing and no `fallback_command` is defined, the job fails.

## 3) Repository contracts (`.sniptail/run`)

In each repo, create executable contract scripts:

```text
.sniptail/
  run/
    deploy-preview
    deploy-preview.params.toml
    db-migration-sanity
```

Example contract:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Typed params are exposed by the worker as env vars.
echo "target_env=${SNIPTAIL_RUN_PARAM_TARGET_ENV:-}"
echo "dry_run=${SNIPTAIL_RUN_PARAM_DRY_RUN:-}"
echo "all_params=${SNIPTAIL_RUN_PARAMS_JSON:-{}}"
```

Make contracts executable:

```bash
chmod +x .sniptail/run/deploy-preview .sniptail/run/db-migration-sanity
```

## 4) Parameter sidecar (`.params.toml`)

Use `<action-id>.params.toml` to define typed inputs and optional multi-step UI.

Example (`.sniptail/run/deploy-preview.params.toml`):

```toml
schema_version = 1

[[parameters]]
id = "target_env"
label = "Target environment"
type = "string"
ui_mode = "select"
required = true
options = ["staging", "preprod", "prod"]

description = "Where to run the deploy simulation"

[[parameters]]
id = "dry_run"
label = "Dry run"
type = "boolean"
ui_mode = "boolean"
default = true

[[steps]]
id = "basic"
title = "Basics"
fields = ["target_env", "dry_run"]
```

Parameter types:

- `string`
- `number`
- `boolean`
- `string[]`

UI modes:

- `auto`, `text`, `textarea`, `select`, `multiselect`, `boolean`, `number`, `secret`

Notes:

- If `steps` is omitted, a default single step is generated with all parameters.
- Step `fields` must reference known parameter IDs, and all parameters must be covered by steps.
- Parameter IDs must match `^[a-z][a-z0-9_]*$`.
- `secret` (or `sensitive = true`) values are redacted from chat summaries/log redaction paths.

## 5) Sync metadata into catalog

Run actions shown by the bot come from repo catalog metadata (`providerData.sniptail.run`).

Sync metadata after adding/updating contracts or sidecars:

```bash
sniptail repos sync-run-actions
```

Or for one repo:

```bash
sniptail repos sync-run-actions --repo <repo-key>
```

Worker startup also attempts this sync automatically.

## 6) Multi-repo behavior

When users select multiple repos for one run action:

- The action ID must exist for every selected repo.
- Parameter schema is merged across repos:
  - required params must be shared,
  - options are intersected,
  - incompatible types/bounds/options fail validation.

This is why keeping sidecar schemas consistent across repos is important.

## 7) Runtime parameter environment variables

Before executing contract/fallback commands, the worker exports:

- `SNIPTAIL_RUN_PARAM_<PARAM_ID>` per parameter (uppercased, non-alnum replaced with `_`)
- `SNIPTAIL_RUN_PARAMS_JSON` with all normalized params as JSON

Serialization:

- `string` stays raw string
- `number`, `boolean`, `string[]` are JSON-serialized in per-param env vars

## 8) Quick verification checklist

1. Add matching action ID in `sniptail.bot.toml` (`label` + `description`).
2. Add same action ID in `sniptail.worker.toml` under `[run.actions.<id>]`.
3. Add `.sniptail/run/<id>` contract script in each target repo and `chmod +x` it.
4. Optionally add `.sniptail/run/<id>.params.toml` for typed params/steps.
5. Run `sniptail repos sync-run-actions`.
6. Start/restart worker and bot.
7. In Slack/Discord, run `/...-run` and confirm the action appears for selected repos.

## 9) Common failures

- `Run action "<id>" is not configured in worker config.`
  - Missing `[run.actions.<id>]` in `sniptail.worker.toml`.
- Action not visible in UI:
  - missing in bot config, or
  - missing metadata for one/more selected repos (sync needed), or
  - action IDs differ by name/casing.
- `...exists but is not executable... chmod +x ...`
  - Contract file exists but is not executable.
- `No run contract found ... and no fallback_command configured.`
  - Define a contract file, or add `fallback_command`.
- Sidecar parse errors (`Invalid run action sidecar ...`)
  - Fix `.params.toml` schema/field types and re-sync.
