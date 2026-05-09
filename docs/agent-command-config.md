# Agent Command Configuration

The worker-side agent command is configured under `[agent]` in `sniptail.worker.toml`.

This feature currently powers the Discord `/sniptail-agent` command. It starts an interactive coding-agent session in a Discord thread, supports follow-up messages, stop/steer controls, and provider-specific permission or question prompts when available.

## Minimal example

```toml
[agent]
enabled = true
default_workspace = "snatch"
default_agent_profile = "build"
interaction_timeout_ms = 1800000
output_debounce_ms = 15000

[agent.workspaces.snatch]
path = "$HOME/Perso/snatch"
label = "snatch"
description = "Main checkout"

[agent.profiles.build]
provider = "opencode"
profile = "build"
label = "Build"
description = "General purpose build agent"
```

## `[agent]`

- `enabled`: enables the Discord agent command flow on the worker. Default: `false`.
- `default_workspace`: default workspace key used when the user does not choose one explicitly. Required when `enabled = true`.
- `default_agent_profile`: default profile key used when the user does not choose one explicitly. Required when `enabled = true`.
- `interaction_timeout_ms`: timeout for pending permission requests and question prompts. Default: `1800000` (30 minutes).
- `output_debounce_ms`: debounce interval for streamed agent output updates posted back to Discord. Default: `15000`.

When `enabled = true`, at least one workspace and one profile must be configured.

## `[agent.workspaces.<key>]`

Each workspace defines a worker-local root directory available to agent sessions.

- `path`: required absolute path after `$HOME` / `~` expansion
- `label`: optional display label for UI/autocomplete
- `description`: optional longer description for UI/autocomplete

Example:

```toml
[agent.workspaces.snatch]
path = "$HOME/Perso/snatch"
label = "snatch"
description = "Main Sniptail checkout"
```

The optional `/sniptail-agent` `cwd` argument is resolved relative to the selected workspace path.

## `[agent.profiles.<key>]`

Each profile selects the underlying coding-agent provider and its provider-specific defaults.

Shared fields:

- `provider`: required, one of `codex`, `copilot`, or `opencode`
- `profile`: optional provider-native agent/profile name
- `model`: optional explicit model override
- `reasoning_effort`: optional explicit reasoning override; requires `model`
- `label`: optional display label for UI/autocomplete
- `description`: optional longer description for UI/autocomplete

OpenCode-only field:

- `model_provider`: required when `provider = "opencode"` and `model` is set

Restrictions:

- `model_provider` is not supported for `codex` profiles
- `model_provider` is not supported for `copilot` profiles
- every profile must define at least one of `profile` or `model`

## Provider behavior

### Codex profiles

`profile` maps to Codex SDK constructor `config.profile`.

Example:

```toml
[agent.profiles.codex-readonly]
provider = "codex"
profile = "readonly"
label = "Codex Readonly"
```

Precedence:

- explicit `model` / `reasoning_effort` in the Sniptail agent profile win
- otherwise, when `profile` is set, the Codex CLI profile supplies missing defaults
- otherwise, Sniptail falls back to global `[codex]` default model settings

When a Codex profile `profile` is set, Sniptail does not inject its normal default `sandboxMode = "workspace-write"` or `approvalPolicy = "never"`. That allows the selected Codex CLI profile to own `sandbox_mode`, `approval_policy`, and similar config unless the worker passes explicit overrides.

### Copilot profiles

`profile` maps to the Copilot session `agent`.

Example:

```toml
[agent.profiles.copilot-review]
provider = "copilot"
profile = "reviewer"
label = "Copilot Reviewer"
```

Precedence:

- explicit `model` / `reasoning_effort` in the Sniptail agent profile win
- otherwise, when `profile` is set, the selected Copilot profile supplies missing defaults
- otherwise, Sniptail falls back to global `[copilot]` default model settings

### OpenCode profiles

`profile` maps to the OpenCode prompt `agent`.

Example:

```toml
[agent.profiles.opencode-build]
provider = "opencode"
profile = "build"
label = "OpenCode Build"
```

Precedence:

- explicit `model`, `model_provider`, and `reasoning_effort` in the Sniptail agent profile win
- otherwise, when `profile` is set, the selected OpenCode profile supplies missing defaults
- otherwise, Sniptail falls back to global `[opencode]` default model settings

## Runtime behavior summary

- Codex: stop aborts the active turn; steer aborts the current turn and runs the steered prompt next
- Copilot: stop aborts the active session; steer and active queue use native SDK `immediate` / `enqueue` modes
- OpenCode: stop aborts the active session; steer is worker-managed by aborting and running the steered prompt next

Pending permission or question interactions are cleared when a session ends, fails, or stops.
