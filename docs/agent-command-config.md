# Agent Command Configuration

Worker-side agent execution is configured under `[agent]` in `sniptail.worker.toml`.
Bot-side agent command defaults are configured under `[agent_command]` in `sniptail.bot.toml`.

This feature powers interactive coding-agent sessions with follow-ups, stop/steer controls, and provider-specific permission or question prompts when available. In multi-worker deployments, the bot aggregates worker capabilities from the shared registry, chooses an eligible worker for each new session, and routes later session controls back to that same worker.

## Minimal example

```toml
[agent]
enabled = true
interaction_timeout_ms = 1800000
output_debounce_ms = 15000

[worker]
id = "linux-build-1"
label = "Linux Build 1"

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
- `interaction_timeout_ms`: timeout for pending permission requests and question prompts. Default: `1800000` (30 minutes).
- `output_debounce_ms`: debounce interval for streamed agent output updates posted back to Discord. Default: `15000`.

When `enabled = true`, at least one workspace and one profile must be configured.

## `[worker]`

- `id`: stable worker identity used by agent-command multi-worker routing. Required when `queue_driver = "redis"` and `[agent].enabled = true`. Defaults to `default` for local or in-process mode.
- `label`: optional operator-facing worker label.

Environment overrides:

- `SNIPTAIL_WORKER_ID`
- `SNIPTAIL_WORKER_LABEL`

## `[agent_command]` in `sniptail.bot.toml`

- `default_workspace`: optional default workspace key used when the user does not choose one explicitly.
- `default_agent_profile`: optional default profile key used when the user does not choose one explicitly.

Environment overrides:

- `AGENT_COMMAND_DEFAULT_WORKSPACE`
- `AGENT_COMMAND_DEFAULT_AGENT_PROFILE`

These defaults are bot policy. They are resolved against the aggregated live worker capabilities at command time. If a configured default is missing, conflicted, or not served by any live worker, Sniptail ignores it for prepopulation and rejects implicit session start with a configuration error.

## Multi-Worker Routing

When `queue_driver = "redis"` and multiple workers are running:

- each worker advertises its `[agent.workspaces]` and `[agent.profiles]` through the shared `registry`
- the bot aggregates those records into logical workspace/profile choices
- the bot chooses an eligible worker when starting a new session
- the bot stores `ownerWorkerId` on the session record
- `agent.session.start`, follow-ups, stop/steer controls, permission decisions, and question answers are routed to the owner worker mailbox

Sniptail does not migrate a live agent session to another worker automatically. Worker-local prompt state, pending interactions, runtime handles, and provider session files remain tied to the worker that owns the session.

## Registry Requirements

For Redis multi-worker agent mode, all bots and workers in one deployment must use the same shared `[registry]` backend and namespace.

Recommended backends:

- `db = "pg"` for multi-machine shared state
- `db = "redis"` when Redis should also hold registry state

`db = "sqlite"` remains valid for local or in-process development, but it is not valid for Redis multi-worker agent routing because SQLite state is local to one machine.

## Worker Selection And Conflicts

The bot treats `[agent.workspaces]` and `[agent.profiles]` as worker-local execution capabilities.

Routing rules:

- if exactly one live worker matches the selected workspace/profile pair, Sniptail routes there automatically
- if multiple live workers match, Sniptail may allow an operator to choose a specific worker
- if no worker is selected explicitly, Sniptail uses least-active-session routing with stable worker ID tie-breaking

Conflict handling:

- workspace keys may be shared by multiple workers when they represent the same logical choice
- if workers advertise the same workspace key with different `label` or `description`, the workspace becomes ambiguous and worker selection is required
- if workers advertise the same profile key with incompatible provider or execution settings, Sniptail treats that profile key as conflicted and blocks new sessions until operator config is fixed

Worker-local absolute workspace paths are never exposed in bot-facing capability metadata.

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

When the same workspace key exists on multiple workers, Sniptail stores the logical `workspaceKey` and relative `cwd`, not the expanded absolute path.

## `[agent.profiles.<key>]`

Each profile selects the underlying coding-agent provider and its provider-specific defaults.

Shared fields:

- `provider`: required, one of `codex`, `copilot`, `opencode`, or `acp`
- `profile`: optional provider-native agent/profile name
- `model`: optional explicit model override
- `reasoning_effort`: optional explicit reasoning override; requires `model`
- `label`: optional display label for UI/autocomplete
- `description`: optional longer description for UI/autocomplete

OpenCode-only field:

- `model_provider`: required when `provider = "opencode"` and `model` is set

ACP-only fields:

- `agent`: optional preset, currently `opencode` or `copilot`
- `command`: optional explicit ACP stdio command array, required when `agent = "custom"` and useful for other ACP-compatible agents
- `env`: optional table of environment variables added when launching the ACP command
- `model_provider`: optional ACP session config override when the launched ACP agent exposes a compatible provider option

Restrictions:

- `model_provider` is not supported for `codex` profiles
- `model_provider` is not supported for `copilot` profiles
- non-ACP profiles must define at least one of `profile` or `model`
- ACP profiles must define at least one of `agent` or `command`

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

### ACP profiles

ACP profiles launch an Agent Client Protocol stdio agent and use its session APIs for interactive turns.

Preset examples:

```toml
[agent.profiles.acp-opencode]
provider = "acp"
agent = "opencode"
profile = "build"
label = "OpenCode ACP"

[agent.profiles.acp-copilot]
provider = "acp"
agent = "copilot"
label = "Copilot ACP"
```

Custom command example:

```toml
[agent.profiles.acp-custom]
provider = "acp"
command = ["/usr/local/bin/my-acp-agent", "--stdio"]
label = "Custom ACP"
```

For ACP profiles, `profile`, `model`, `model_provider`, and `reasoning_effort` are forwarded as ACP session overrides when the launched agent exposes compatible options. Permission requests and form elicitations are rendered through Sniptail's interactive permission and question UI.

## Runtime behavior summary

- Codex: stop aborts the active turn; steer aborts the current turn and runs the steered prompt next
- Copilot: stop aborts the active session; steer and active queue use native SDK `immediate` / `enqueue` modes
- OpenCode: stop aborts the active session; steer is worker-managed by aborting and running the steered prompt next
- ACP: stop cancels the active ACP prompt; steer is worker-managed by cancelling the active prompt and running the steered message next

Pending permission or question interactions are cleared when a session ends, fails, or stops.

## Agent Session Browser And Attach

Slack and Discord expose `/sniptail-agent-sessions` to browse previous provider sessions on a selected worker. The command requires a worker id and accepts optional `agent_profile`, `workspace`, and relative `cwd` selectors. Worker-local absolute workspace paths stay on the worker; bot UIs and session records use only the worker id, workspace key, and relative cwd.

Session listing and attach are supported for ACP, OpenCode, and Copilot profiles. Codex profiles are not listable because Codex does not expose previous-session listing through the SDK.

Attaching a listed session creates a completed Sniptail agent-session record with the selected provider-native session id. It posts a seed message in a Slack or Discord thread and does not enqueue a new prompt. The next user message in that attached thread follows the normal `agent.session.message` path and resumes or loads the provider session on the owner worker.

Operators should configure listable profiles so their provider session storage is reachable by the worker selected in the browser. If a provider cannot load or resume that stored session later, follow-ups in the attached thread will fail even though the attach record was created successfully.

## Owner-Stale Sessions

If the owner worker disappears after a session starts:

- the session remains active with an owner-stale condition
- follow-ups, stop/steer controls, and interaction responses are rejected until the owner returns or an operator clears the session
- the stale-owner condition clears automatically when the same worker ID becomes live again

Sniptail does not silently start a replacement provider session on another worker.

## Mailbox Priority

Each worker consumes:

- the shared `sniptail-worker-events` queue for generic worker events
- its own mailbox queue `sniptail-worker-mailbox:<workerId>` for owner-routed agent session events

Mailbox-enabled workers favor mailbox work over shared worker events. Shared worker-event consumption is paused while mailbox work is pending, and mailbox/shared worker-event handling is serialized inside the worker runtime. A shared worker event that was already reserved before the pause may still wait locally until mailbox work drains.
