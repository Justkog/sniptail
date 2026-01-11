# Codebase structure (high level)

- `src/index.ts`: bootstraps app + worker.
- `src/slack/`: Slack app wiring, modals, helpers.
- `src/queue/`: BullMQ queue helpers.
- `src/worker/`: job pipeline runner.
- `src/git/`, `src/gitlab/`: repo and MR operations.
- `src/codex/`: Codex integration.
- `src/config/`: configuration.
- `src/types/`: shared types.
