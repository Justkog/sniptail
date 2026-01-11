# Snatchy project overview

Purpose: Slack bot/service that accepts /snatchy-ask and /snatchy-implement commands, queues jobs in BullMQ, and runs Codex-based workflows against repo allowlist, posting results back to Slack (reports/MRs).

Tech stack: Node.js (ESM), TypeScript, Slack Bolt, BullMQ (Redis), Git/GitLab integration, OpenAI Codex SDK, Pino logging, dotenv.

Entrypoint: `src/index.ts` starts Slack app (Socket Mode), creates queue, starts worker.
