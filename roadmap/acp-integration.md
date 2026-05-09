# Agent Client Protocol Integration Roadmap

## Goal

Add Agent Client Protocol (ACP) support as a generic way to run coding agents without removing the native Codex, Copilot, and OpenCode integrations.

ACP should be an additional integration path, not an immediate replacement. Native integrations can continue to provide provider-specific features while ACP gives Sniptail a common protocol for agents that expose an ACP server.

## Config Spec

ACP config is split across two surfaces:

- Agent command: interactive chat sessions with follow-ups, stop/steer controls, permission requests, and questions.
- Managed jobs: queued ASK, PLAN, IMPLEMENT, MENTION, REVIEW, and related job commands.

These surfaces should share the same ACP launch semantics, but they should not be forced into the same user-facing config shape. Agent command selects profiles under `[agent.profiles]`; managed jobs select the worker's job agent through the normal agent registry.

### Agent Command

ACP should be exposed as a fourth agent-command profile provider:

```toml
[agent.profiles.opencode-acp]
provider = "acp"
agent = "opencode"
profile = "build"
label = "OpenCode ACP"
description = "OpenCode through Agent Client Protocol"
```

For known ACP agents, `agent` can select a launch preset so operators do not need to know the exact command line.

Initial presets:

```text
opencode -> ["opencode", "acp"]
copilot  -> ["copilot", "--acp", "--stdio"]
```

Do not add a Codex preset until the exact Codex ACP CLI invocation is verified.

Profiles may override the preset with an explicit command array:

```toml
[agent.profiles.custom-acp]
provider = "acp"
command = ["/usr/local/bin/my-acp-agent", "--stdio"]
label = "Custom ACP Agent"
```

Profiles may include both `agent` and `command`. In that case:

- `command` controls process launch.
- `agent` remains semantic identity and metadata.

Resolution rules:

- `provider = "acp"` requires either `agent` or `command`.
- If `command` is absent, `agent` must match a known preset.
- `command` is a non-empty string array.
- Every `command` item must be a non-empty string.
- Parsed worker config should store the resolved command array so the runtime adapter does not need to resolve presets.
- `agent = "custom"` without `command` is invalid.

Optional fields:

- `profile`: native agent profile, preset, or persona to select inside the launched ACP agent.
- `model`: explicit model override when the launched ACP agent supports model selection through ACP.
- `model_provider`: explicit model provider override when the launched ACP agent supports provider selection through ACP.
- `reasoning_effort`: explicit reasoning override when the launched ACP agent supports reasoning configuration through ACP.
- `env`: per-profile environment variables for the ACP process.
- `label`: display label for Slack/Discord profile selectors.
- `description`: longer display description.

`profile` replaces the existing agent-command `name` terminology for ACP and should eventually replace it for native providers as well. The old `name` field means "provider-native agent profile" today; `profile` is clearer and should be the preferred config name. During migration, native providers can continue accepting `name` as an alias, but new ACP config should use `profile`.

If `profile` is set, `model`, `model_provider`, and `reasoning_effort` may be omitted because the launched ACP agent profile is expected to own those defaults.

If any explicit model fields are set, the ACP adapter must apply them through ACP capabilities or raise an error. It must not silently ignore unsupported model, provider, or reasoning overrides.

ACP profile metadata sent to the bot should include `provider = "acp"` and optional `agent`, `profile`, `model`, `modelProvider`, `reasoningEffort`, `label`, and `description`. It should not include `command` or `env`, because those are worker-local operational details.

### Managed Jobs

Managed jobs should support ACP through the shared coding-agent registry rather than through `[agent.profiles]`.

Managed-job ACP v1 should support local stdio only. It should not add Docker execution mode. Operators that need isolation should wrap the ACP agent in their own command and expose that wrapper through `command`.

The config should add an ACP agent descriptor that can be selected wherever existing job agents are selected:

```toml
[worker]
primary_agent = "acp"

[acp]
agent = "opencode"
profile = "build"
```

As with agent-command profiles, known agents can use launch presets:

```text
opencode -> ["opencode", "acp"]
copilot  -> ["copilot", "--acp", "--stdio"]
```

Explicit launch config should be available for custom ACP agents:

```toml
[acp]
command = ["/usr/local/bin/my-acp-agent", "--stdio"]
```

The managed-job ACP config should resolve to the same internal launch shape as agent command:

```ts
{
  agent?: string;
  profile?: string;
  command: string[];
  env?: Record<string, string>;
  model?: string;
  modelProvider?: string;
  reasoningEffort?: ModelReasoningEffort;
}
```

Managed-job ACP support should map normal job execution onto ACP sessions:

- ASK, PLAN, IMPLEMENT, MENTION, and REVIEW build prompts through the existing managed-job prompt pipeline.
- The ACP adapter starts or resumes an ACP session for the job when possible.
- ACP streamed updates feed existing job logs and summaries.
- ACP final assistant output becomes the managed job final response.

Managed-job ACP config should also support explicit `model`, `model_provider`, and `reasoning_effort` fields. As with agent-command profiles, those fields must be applied through ACP capabilities or fail fast with a clear error if the launched ACP agent does not support them.

If `profile` is configured for managed jobs, explicit model fields are optional because the native ACP agent profile can supply them. If both `profile` and explicit model fields are configured, explicit model fields win.

## Runtime Behavior

ACP prompt updates should be mapped into Sniptail's existing standardized events:

- ACP `agent_message_chunk` becomes normal streamed assistant output.
- ACP tool calls and tool-call updates become loggable progress events.
- ACP permission requests become Sniptail permission interactions.
- ACP cancellation backs stop controls.

Agent-command steer should use conservative semantics for v1:

- Cancel the active ACP prompt.
- Queue the steered message as the next prompt turn.

This matches the existing Codex and OpenCode behavior and avoids assuming every ACP agent supports Copilot-style immediate or enqueue controls.

## Session Persistence

ACP `sessionId` values should be stored as Sniptail `codingAgentSessionId` values once an ACP session is created.

Follow-up behavior:

- If the ACP runtime is still active in the current worker process, reuse the active ACP session directly.
- If the ACP runtime is no longer active, launch the configured ACP agent and inspect its advertised capabilities.
- If the agent advertises `session/load`, use `session/load` with the stored ACP `sessionId`.
- If load is not supported when a stored ACP `sessionId` must be continued, raise an error and let it bubble to the communication channel.

Sniptail should not silently start a new ACP session when a stored ACP `sessionId` cannot be loaded. Starting a new session would lose conversation context while appearing to continue the same chat or job.

## Open Questions

- None currently.

## Implementation Steps:

1. ACP Config Model
Add ACP config parsing without wiring runtime execution yet.

Define:

- `provider = "acp"` for agent-command profiles.
- `[acp]` worker config for managed jobs.
- `agent` launch presets for known ACP agents.
- `command` as the resolved non-empty argv array.
- `profile` as the preferred provider-native profile field.
- `model`, `model_provider`, and `reasoning_effort` as explicit overrides.
- `env` for ACP process environment overrides.

Keep the parser responsible for resolving presets into `command`. Runtime code should receive a complete command array and should not know about preset lookup.

2. Profile Field Migration
Introduce `profile` as the preferred name for provider-native agent profiles.

For this step:

- Accept `profile` for ACP profiles.
- Replace existing native `name` fields with `profile`.
- Remove `name` from the config types and parser.
- Do not keep `name` as a backward-compatible alias.
- Update native Codex, Copilot, and OpenCode agent-command profiles to read from `profile`.
- Include ACP `profile` in bot metadata.

This is a breaking config migration, but it keeps the provider-native profile concept explicit and avoids carrying two names for the same field.

3. ACP Core Client Wrapper
Add a low-level ACP wrapper in `packages/core`.

The wrapper should:

- Spawn the configured command over local stdio.
- Create an ACP client-side connection with `@agentclientprotocol/sdk`.
- Initialize the connection and expose advertised capabilities.
- Create a new session or load an existing session id.
- Send one prompt turn and stream session updates.
- Cancel the active prompt.
- Close or terminate the child process cleanly.

Do not map to Discord, Slack, or job artifacts in this layer. It should only expose ACP-native concepts and a small Sniptail-friendly runtime handle.

4. ACP Event Mapping
Create shared mapping helpers for ACP updates.

The first mapping pass should cover:

- `agent_message_chunk` to assistant output text.
- `agent_thought_chunk` to optional log output, not user-facing chat by default.
- `tool_call` and `tool_call_update` to progress log entries.
- `plan` to readable plan progress.
- usage updates to logs or metadata when available.

This step should not implement permission resolution yet. It only establishes stable output and logging behavior.

5. Agent-Command ACP Adapter: Basic Prompt
Register ACP as an interactive agent provider in the worker.

Start with a single prompt turn:

- Resolve workspace and cwd through the existing agent-command resolver.
- Launch the ACP runtime from the resolved profile config.
- Start a new ACP session when no `codingAgentSessionId` exists.
- Store ACP `sessionId` as `codingAgentSessionId`.
- Send the prompt.
- Stream debounced assistant output through existing bot events.
- Mark the Sniptail agent session completed or failed.

At this stage, follow-ups, stop, steer, permissions, and questions can remain unsupported.

6. Agent-Command Session Load
Add continuation support for ACP agent-command sessions.

When a stored `codingAgentSessionId` exists and no active ACP runtime is reachable:

- Launch the configured ACP command.
- Inspect capabilities after initialization.
- Require `session/load`.
- Call `session/load` with the stored ACP session id.
- If `session/load` is unsupported or fails, raise an error to the communication channel.

Do not silently create a new ACP session for a stored ACP session id.

7. Agent-Command Stop And Steer
Add active prompt controls.

Stop should:

- Cancel the active ACP prompt.
- Mark the Sniptail session stopped.
- Clear pending ACP prompt state.

Steer should:

- Cancel the active ACP prompt.
- Queue the steered user message as the next turn.
- Run that queued message after cancellation completes.

This intentionally matches Codex/OpenCode worker-managed steer behavior.

8. ACP Permission Bridge
Map ACP permission requests into Sniptail interactions.

Flow:

- Convert ACP `requestPermission` into `agent.permission.requested`.
- Store the pending ACP permission resolver in worker memory.
- Resolve it from `agent.interaction.resolve`.
- Publish permission update events on approve, reject, expire, fail, stop, or session end.

If a prompt is cancelled while ACP is waiting for permission, respond to ACP with its cancelled permission outcome.

9. ACP Question/Elicitation Bridge
Add ACP user-input support if the target SDK surface is stable enough.

Flow:

- Convert ACP elicitation or equivalent user-input request into `agent.question.requested`.
- Store the pending resolver in worker memory.
- Resolve it from `agent.interaction.resolve`.
- Clear pending questions on stop, failure, timeout, or session end.

If the ACP user-input API remains unstable, keep this step explicitly gated and do not block basic ACP prompt support on it.

10. Agent-Command Model/Profile Application
Apply ACP `profile`, `model`, `model_provider`, and `reasoning_effort` fields.

Implementation should:

- Prefer ACP session mode/config/model APIs when advertised by the launched agent.
- Treat `profile` as the native agent profile or mode selection.
- Let `profile` supply defaults when explicit model fields are absent.
- Let explicit model fields override profile defaults when supported.
- Raise a clear error when explicit model fields are configured but cannot be applied.

Do not silently ignore unsupported explicit model configuration.

11. Managed-Job ACP Descriptor
Add ACP as a managed-job agent id and descriptor.

This step should:

- Add `acp` to the job agent registry.
- Parse `[acp]` worker config.
- Keep execution local stdio-only.
- Build run options from the resolved ACP config.
- Reuse the existing managed-job prompt pipeline for ASK, PLAN, IMPLEMENT, MENTION, and REVIEW.
- Stream ACP updates into existing job logs.
- Return ACP final assistant output as the job final response.

Do not add Docker execution mode. Operators that need isolation should provide a wrapper command.

12. Managed-Job Session And Model Behavior
Finish managed-job parity with the ACP session rules.

The managed-job adapter should:

- Store ACP `sessionId` as the job thread/session id when appropriate.
- Use `session/load` for managed-job continuations when a stored ACP session id exists.
- Raise an error if load is required but unsupported.
- Apply `profile`, `model`, `model_provider`, and `reasoning_effort` with the same fail-fast semantics as agent command.

13. Preflight And Diagnostics
Add operator-facing checks and failure messages.

Preflight should verify:

- The resolved command executable exists or can be spawned.
- Preset resolution works.
- Local stdio launch reaches ACP initialization.
- Required explicit model settings can be applied when configured, if this can be checked cheaply.

Runtime errors should include the profile key or `[acp]` config source, command basename, and ACP agent identity when known.

14. Tests And Documentation
Add focused coverage after each functional slice.

Minimum coverage:

- Config parser accepts preset and explicit ACP command forms.
- Config parser rejects missing command/preset, empty command arrays, and unsupported explicit model fields when capability checks fail.
- ACP core wrapper handles initialize, new session, load session, prompt, updates, cancel, and process cleanup.
- Agent-command ACP basic prompt, session load, stop, steer, permission resolve, and failure bubbling.
- Managed-job ACP prompt execution and local stdio-only behavior.
- Bot metadata includes ACP profile fields and excludes command/env.

Update `docs/agent-command-config.md` and managed-job setup docs once the first usable ACP slice lands.
