# Chat Commands Overview

- `/sniptail-ask`: Generates a Markdown report, uploads it to Slack, and posts a completion message.
- `/sniptail-plan`: Generates a Markdown plan, uploads it to Slack, and posts a completion message.
- `/sniptail-implement`: Runs the configured coding agent to implement changes, runs checks, pushes branches, and opens GitLab MRs or GitHub PRs.
- `/sniptail-bootstrap`: Creates a GitHub/GitLab repository and appends it to the allowlist.
- `/sniptail-clear-before`: Cleanup of historical job data (available in Slack and Discord).
- `/sniptail-usage`: Shows Codex usage for the day/week and quota reset timing.

Permissions are controlled by `[permissions]` and `[[permissions.rules]]` in `sniptail.bot.toml` with rule effects:
- `allow`: execute immediately
- `deny`: reject
- `require_approval`: create an approval request with Approve/Deny/Cancel actions in-channel
