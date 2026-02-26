# Chat Commands Overview

- `/sniptail-ask`: Generates a Markdown report, uploads it to Slack, and posts a completion message.
- `/sniptail-explore`: Explores repo-grounded solution options in a Markdown report, uploads it, and posts a completion message.
- `/sniptail-plan`: Generates a Markdown plan, uploads it to Slack, and posts a completion message.
- `/sniptail-implement`: Runs the configured coding agent to implement changes, runs checks, pushes branches, and opens GitLab MRs or GitHub PRs.
- `/sniptail-run`: Runs a configured repository action (`.sniptail/run/<action-id>`) across selected repos and uploads a run report.
- `/sniptail-bootstrap`: Creates a GitHub/GitLab repository and appends it to the allowlist.
- `/sniptail-clear-before`: Cleanup of historical job data (available in Slack and Discord).
- `/sniptail-usage`: Shows Codex usage for the day/week and quota reset timing.

Permissions are controlled by `[permissions]` and `[[permissions.rules]]` in `sniptail.bot.toml` with rule effects:
- `allow`: execute immediately
- `deny`: reject
- `require_approval`: create an approval request with Approve/Deny/Cancel actions in-channel
- In `[[permissions.rules]]`, omitting `actions` applies the rule broadly:
  - for `allow`/`deny`: all actions
  - for `require_approval`: all non-approval actions (`approval.grant|approval.deny|approval.cancel` are excluded)
