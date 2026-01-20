# Environment configuration
- Populate `.env` from `.env.example`.
- Required vars enforced in `packages/core/src/config/env.ts`.
- Notable vars: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `REDIS_URL`, `GITLAB_BASE_URL`, `GITLAB_TOKEN`, `REPO_ALLOWLIST_PATH`, `REPO_CACHE_ROOT`, `JOB_WORK_ROOT`, `JOB_REGISTRY_PATH`, `CODEX_EXECUTION_MODE` (`local` or `docker`), `CODEX_DOCKERFILE_PATH`, `CODEX_DOCKER_IMAGE`, `CODEX_DOCKER_BUILD_CONTEXT`.
- `REPO_ALLOWLIST_PATH` JSON format supports `sshUrl`/`projectId` or `localPath` entries.
- Docker execution uses `scripts/codex-docker.sh` with `CODEX_EXECUTION_MODE=docker`.