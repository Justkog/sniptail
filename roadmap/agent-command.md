# Agent Command Roadmap

## Goal

Add a Discord-first command that opens a freeform session with the primary coding agent.

The command should feel close to using the coding agent in a terminal: the user provides a prompt, the agent runs in a selected working directory, and follow-up messages continue the same session. Sniptail should broker the session, permissions, routing, logging, and Discord experience, but should not impose the structured branch, commit, or merge request flow used by implementation jobs.

This is a proposed feature and does not describe current behavior.

## Non-goals

- Sniptail should not clone remote repositories for this command.
- Sniptail should not create a branch, commit, pull request, or merge request for this command.
- Sniptail should not decide where a remote repository should be cloned.
- Sniptail should not treat this command as a replacement for structured job types such as ASK, IMPLEMENT, REVIEW, or RUN.

The underlying coding agent may still clone repositories, create worktrees, commit changes, or open review requests if the user asks it to and its environment supports that.

## Discord Experience

The first version should focus on Discord.

When the command is started from a regular channel, Sniptail should create a Discord thread and bind one coding-agent session to that thread. The thread becomes the user's terminal-like interaction surface.

Expected flow:

1. A user starts an agent session with a prompt.
2. Sniptail resolves the selected coding-agent profile, workspace, sandbox, and other options.
3. Sniptail creates a thread in the current channel.
4. The worker starts the coding agent in the resolved working directory.
5. Messages emitted by the coding agent are posted back into the thread.
6. User messages in the thread are forwarded as follow-up input to the same coding-agent session.
7. The active prompt ends when the agent exits, the user stops it, it times out, or the worker can no longer keep it alive. The underlying coding-agent session may remain in the agent's own state data for later continuation.

A thread should have at most one active coding-agent session. If multiple messages arrive while the agent is busy, Sniptail should serialize them or report that input is queued.

## Agent Interactions

Some coding agents can ask for user input while a prompt is still running. Sniptail should bridge those requests into the Discord session thread instead of forcing the agent to run fully unattended.

The first interaction types to support are:

- permission requests, such as approving or denying a tool call
- question requests, such as answering a clarification question or choosing between options

The worker should keep awaiting the underlying agent's final response. Interaction handling should run as a side channel while that await is pending.

Expected flow:

1. The worker starts the agent prompt and subscribes to the agent event stream.
2. The agent emits an interaction request event.
3. The worker records the pending interaction by request id and posts a bot event for Discord.
4. The bot posts an interactive message in the session thread.
5. The user responds with buttons, selects, or a modal.
6. The bot validates the user and enqueues a worker event with the interaction decision.
7. The session-owning worker receives the worker event and calls the coding agent's reply API.
8. The original agent prompt continues and eventually returns a final response.

For the first implementation, freeform agent sessions should use a single session-owning worker mode. The worker process that started the agent session should own its pending interactions. This avoids routing approval or question replies to the wrong worker while the session is live.

### Permission Requests

Permission requests should be shown as Discord messages in the session thread.

Example:

```text
Permission requested

Tool:
bash

Action:
pnpm run check

Workspace:
snatch / apps/worker
```

Suggested controls:

- `Approve once`
- `Always allow`
- `Reject`
- `Stop session`

`Always allow` should be available only when the underlying agent supports it and the selected runtime policy allows it. It should apply only to the active agent session unless a stronger persistent policy is explicitly designed later.

For OpenCode v2, this maps naturally to `permission.asked` and `permission.replied` events. Sniptail can reply with:

```ts
client.permission.reply({
  requestID,
  directory,
  workspace,
  reply: 'once' | 'always' | 'reject',
  message,
});
```

### Question Requests

Question requests should use Discord controls that match the question shape.

Recommended UI:

- single-choice question: buttons or a select menu
- multiple-choice question: multi-select menu
- custom text answer: modal text input
- multiple questions: modal with one input/control per question where Discord limits allow

The user should also be able to reject or dismiss the question when they cannot answer it.

For OpenCode v2, this maps naturally to `question.asked`, `question.replied`, and `question.rejected` events. Sniptail can answer with:

```ts
client.question.reply({
  requestID,
  directory,
  workspace,
  answers,
});
```

or reject with:

```ts
client.question.reject({
  requestID,
  directory,
  workspace,
});
```

### Timeouts

Pending agent interactions should have a globally configured timeout. A reasonable default for the first version is 30 minutes.

When the timeout expires:

- permission requests should be rejected
- question requests should be rejected
- Discord should show that the interaction expired
- the agent should be allowed to continue or fail according to its own behavior
- the worker should still close local or Docker runtimes when the prompt finishes or is stopped

This keeps a blocked approval or question from keeping a worker-side runtime alive forever.

### Integration Support

Interaction support is coding-agent-integration specific.

OpenCode v2 appears suitable for this model because the SDK exposes event stream notifications and explicit reply APIs for permissions and questions.

Codex, as currently used by Sniptail through `@openai/codex-sdk` and `codex exec`, should not be assumed to support this interaction bridge. The current Codex SDK path streams events, but does not expose a visible approval-request event or a method to submit an approval decision back into a running turn. Codex interaction forwarding should remain disabled until the integration has a real request/reply API.

## Command Shape

The command should be named `/agent` and should keep the common path short:

```text
/agent prompt:"investigate why the tests are failing"
```

Optional parameters should allow a user to override defaults when needed:

```text
/agent prompt:"fix the worker preflight issue" workspace:snatch cwd:apps/worker agent_profile:build sandbox:workspace-write
```

Potential parameters:

- `prompt`: the initial user prompt.
- `workspace`: a worker-defined workspace key.
- `cwd`: a relative path inside the selected workspace.
- `agent_profile`: a profile/persona exposed by the selected coding agent, such as an OpenCode primary agent.
- `sandbox`: a sandbox mode, if supported by the selected coding-agent integration and runtime policy.
- `model`: a model override, if supported by the selected coding-agent integration and runtime policy.
- `reasoning`: a reasoning-effort override, if supported.
- `approval`: an approval mode, if supported.
- `timeout`: an optional per-session timeout override, subject to config limits.

Advanced parameters should be optional. A user with good defaults should normally only need to provide a prompt.

Discord command inline selects are sufficient for values such as workspace and coding-agent profile.

## Sticky Defaults

Some parameters should be sticky so users do not have to select them every time.

Default resolution order:

1. Explicit command option.
2. Active thread/session setting.
3. User's last successful agent-session setting.
4. Channel or server default.
5. Worker/global default.

Good sticky parameters:

- `workspace`
- `cwd`
- `agent_profile`
- `sandbox`, subject to permission and safety rules
- `model`, if supported
- `reasoning`, if supported
- `approval`, if supported

Non-sticky parameters:

- `prompt`
- one-off timeout extensions
- one-off environment overrides
- dangerous sandbox selections unless they come from an admin-approved runtime preset

Sniptail should store sticky defaults as selectors, not expanded absolute paths. For example:

```json
{
  "workspace": "snatch",
  "cwd": "apps/worker",
  "agentProfile": "build",
  "sandbox": "workspace-write"
}
```

This keeps persisted defaults stable across worker restarts and avoids leaking worker-local filesystem details into user-facing state.

## Coding-Agent Profiles

Coding-agent profiles are profiles/personas exposed by the underlying coding agent.

For OpenCode, this maps to its configured agents. OpenCode has primary agents such as `Build` and `Plan`, supports user-defined agents with custom prompts, models, and tool access, and its SDK prompt function can select one with an `agent?: string` parameter. Sniptail's `agent_profile` option should pass that value through when the selected integration supports it.

This is different from a Sniptail runtime preset. A coding-agent profile chooses how the underlying assistant behaves. A Sniptail runtime preset, if added later, would package Sniptail-side defaults such as workspace, sandbox, timeout, and permission policy.

Example coding-agent profile values:

- `build`
- `plan`
- `reviewer`
- `migration-helper`

Sniptail should treat profile support as integration-specific. If the selected agent does not support named profiles, Sniptail should reject the option or ignore it only when explicitly configured to do so.

## Runtime Presets

Runtime presets could package common Sniptail-side settings so users do not have to understand every runtime option.

Example runtime preset fields:

- agent provider, such as the primary agent, Codex, Copilot, or OpenCode
- default coding-agent profile, if supported
- default model
- default reasoning effort
- default sandbox mode
- default approval mode
- default timeout
- allowed workspace keys
- allowed sandbox overrides
- whether model overrides are allowed

Runtime presets should be worker-resolved. The bot should pass preset keys and coding-agent profile names, not assume provider-specific runtime details.

Workspace definitions and coding-agent profile defaults should live in the worker config. The bot should not resolve these values from its own filesystem or provider-specific agent configuration.

## Working Directory Model

The command should use a workspace selector rather than a raw `cwd` as the main user experience.

The core model is:

```text
resolved cwd = selected workspace root + optional relative cwd
```

Sniptail should resolve this on the worker and enforce that the final path stays inside the selected workspace root.

### Workspace Keys

Named workspaces are the primary mechanism.

Example worker config shape:

```toml
[agent.workspaces.snatch]
path = "/home/jc/Perso/snatch"
default_agent_profile = "build"

[agent.workspaces.dotfiles]
path = "/home/jc/.config"
default_agent_profile = "plan"

[agent.workspaces.infra-tools]
path = "/srv/sniptail/workspaces/infra-tools"
default_agent_profile = "ops-safe"
```

The user would select:

```text
workspace:snatch
workspace:snatch cwd:apps/worker
workspace:infra-tools
```

This works for both local and company deployments:

- A local enthusiast can define workspaces under their home directory, including repos, configuration directories, or tool directories.
- A company can define a curated list of server-side workspaces for specific operational tasks.

### Workspace Roots

For users with many local repositories, named workspaces may become tedious. A second mechanism could allow configured roots with user-selected subpaths.

Example:

```toml
[agent.workspace_roots.personal]
path = "/home/jc/Perso"
allow_subpaths = true

[agent.workspace_roots.company]
path = "/srv/sniptail/workspaces"
allow_subpaths = true
```

The user could select:

```text
root:personal/snatch
root:personal/other-tool
root:company/release-tools
```

The worker must resolve the selected subpath and reject paths that escape the configured root.

This should be optional. Company deployments may prefer named workspaces only.

### Raw Paths

Raw absolute paths should not be the default experience.

They may be useful for a single-user local deployment:

```text
path:/home/jc/Perso/snatch
```

If supported, raw paths should require explicit worker configuration and should still be constrained to allowed roots unless the deployment intentionally enables unrestricted local access.

Recommended policy:

- disabled by default
- available only when explicitly enabled on the worker
- bounded by configured roots by default
- subject to the existing permission system and any runtime-preset or coding-agent-profile restrictions

### Repository Catalog Entries

Repository catalog entries can be useful as selectors, but this command should not use the existing repo cache and worktree preparation flow.

For this command, Sniptail should not clone or checkout remote repositories. If a selected catalog entry points at a local path, it may be usable as a workspace selector. If a selected catalog entry points only at a remote URL, Sniptail should not prepare that repository for the agent.

Recommended behavior:

- local catalog repo: allow `repo:<repoKey>` to resolve to the repo's `localPath`
- remote-only catalog repo: do not resolve to `REPO_CACHE_ROOT`
- remote-only catalog repo: do not automatically clone or checkout the repository
- never run this freeform mode directly inside Sniptail's internal cached clone

For the agent command, the selected workspace is what matters. It becomes the agent's working directory, along with any other configured runtime settings. If the user wants the agent to clone a remote repository, the user can ask the agent to do so from the selected workspace.

## Permissions And Safety

The command should use the existing permission system that protects other commands.

Additional authorization should apply to selected settings:

- whether the user may run this command at all
- which coding-agent profiles the user may select
- which workspaces or workspace roots the user may select
- which sandbox modes the user may select
- whether model or approval-mode overrides are allowed
- whether raw path selection is allowed
- who may answer agent permission requests or questions
- whether `Always allow` is available for permission requests

Dangerous settings should not become silently sticky unless they are part of an approved runtime preset.

## Session Lifecycle

A session should be addressed by channel/thread identity and mapped to one worker-side coding-agent session.

Useful lifecycle controls:

- stop the active prompt
- show current settings
- change selected settings before starting a new session
- clear user defaults
- resolve or expire pending agent interactions
- optionally pause or resume if the underlying agent supports it

The first implementation can be simpler:

- one active session per Discord thread
- no resumability after worker restart unless the underlying agent supports it
- idle timeout
- per-interaction timeout
- explicit stop command or button that aborts the active prompt without clearing the whole coding-agent session

## Implementation Notes

For the first version, OpenCode is the only coding-agent integration expected to support true interactive sessions. In this document, an integration means Sniptail's provider-specific runner for Codex, Copilot, OpenCode, or another coding agent.

For integrations that support this, Sniptail can keep a live process or session handle attached to the Discord thread and forward user messages into it.

For integrations that do not support this, Sniptail should just emit an unsupported message.

For OpenCode, a contained first version can still look like a normal awaited prompt from Sniptail's perspective. The worker can call `session.prompt`, subscribe to the event stream, forward `permission.asked` and `question.asked` events to Discord, reply through OpenCode's permission/question APIs when Discord responds, and keep awaiting the prompt's final response. The OpenCode client object does not need to be the same object for every reply, but the OpenCode runtime that owns the blocked prompt must remain reachable until the prompt completes, is rejected, times out, or the active prompt is stopped.

Agent output posted back to Discord should be debounced. A reasonable first value is 15 seconds: collect streamed updates and post or edit Discord messages in batches so the thread remains readable.

The feature should avoid coupling to `REPO_CACHE_ROOT`. That directory is for Sniptail-managed clone caches used by structured jobs. Freeform agent sessions should run in configured workspaces selected by the user and resolved by the worker.

## Implementation Steps:

1. Config Model
Add worker config for the feature, without wiring Discord yet.

Define:

agent.enabled
agent.workspaces
agent.default_workspace
agent.default_agent_profile
global interaction timeout
output debounce interval
allowed profiles/settings per workspace if needed
This gives you the foundation for cwd resolution and prevents the bot from knowing worker filesystem paths.

2. Workspace Resolver
Build a small worker-side resolver:

workspace key + optional cwd -> absolute cwd
It should:

reject unknown workspace keys
reject path escapes
validate existence if desired
return display-safe metadata for Discord
This block will be reused by the command, sticky defaults, and session startup.

3. Session State Store
Add a minimal agent-session registry.

For v1 it can be in-memory because you want single session-owning worker mode, but model it cleanly:

sessionId
Discord channel/thread/user
workspace/cwd/profile/settings
active prompt state
pending interactions
OpenCode session id/runtime handle
This lets later Discord events route to the right live session.

4. Discord /agent Command Skeleton
Add the command with inline selects for workspace/profile and a prompt field.

At first it can just:

authorize using existing permissions
resolve defaults/options
create the Discord thread
create a session record
post “session starting”
not run OpenCode yet, or run a no-op stub
This validates the Discord UX and queue shape early.

5. Bot-to-Worker Session Events
Introduce worker events for the new mode.

Likely events:

agent.session.start
agent.prompt.stop
agent.interaction.resolve
later agent.session.message for follow-ups
For v1, keep these routed to one worker process. The first real implementation can be simple, but the event types should be explicit.

6. Worker OpenCode Prompt Runner
Implement the OpenCode-backed session runner.

Start with one prompt only:

resolve workspace cwd
create/resume OpenCode session
call session.prompt
stream events
collect final response
close runtime when prompt finishes
No approvals/questions yet. Just prove /agent can run OpenCode and report back.

7. Debounced Discord Output
Add the 15-second output buffer.

The worker should convert OpenCode events into user-readable text and emit bot events in batches. This prevents noisy Discord threads and gives you a stable output path before interactivity.

8. Stop Active Prompt
Add stop support before approvals.

This should abort the current prompt only, not delete the OpenCode session state. The Discord control should map to a worker event that cancels the active prompt/runtime operation.

9. Permission Interaction Bridge
Handle OpenCode permission.asked.

Flow:

detect event
create pending interaction
post Discord buttons
receive button decision
call client.permission.reply
timeout after global timeout and reject
This is the first truly interactive milestone.

10. Question Interaction Bridge
Handle OpenCode question.asked.

Reuse the same pending-interaction machinery, but render:

select menus for choices
modal for custom text
reject/dismiss control
timeout rejection
This should be much easier after permissions are done.

11. Follow-Up Messages In Thread
Forward normal Discord thread messages to the same OpenCode session.

This turns the command from “one prompted run in a thread” into a real session. It should reuse the same active-prompt guard, debounce, stop, and interaction bridge.

12. Sticky Defaults
Add persisted per-user defaults after the core flow works.

Store selectors, not paths:

workspace key
cwd
coding-agent profile
sandbox/settings
Apply resolution order: explicit command option, thread state, user default, channel/server default, worker default.

13. Hardening
Then tighten behavior:

concurrency rules for one active prompt per session
permissions for profile/workspace/interaction answers
audit logs for prompts and approvals
cleanup of expired sessions
better final/error messages
tests around path containment, interaction timeout, and stop behavior
The key ordering is: config and cwd resolver first, then Discord/session skeleton, then OpenCode one-shot run, then debounced output, then stop, then approvals/questions, then follow-up thread messages and sticky defaults. That keeps each step small and avoids building the hardest interactive parts before the session foundation exists.