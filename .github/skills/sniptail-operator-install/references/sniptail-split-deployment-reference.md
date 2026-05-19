# Sniptail Split Deployment Reference

Use this reference only when the user needs bot and worker on different machines or wants independently managed processes.

## When To Use This Path

- the bot host and worker host are separate
- Redis-backed queueing is required
- shared registry state should live in Redis or Postgres instead of local sqlite

## Main Rules

- bot and worker must agree on the queue transport
- do not assume a shared filesystem between bot and worker machines
- resumed managed jobs route back to the worker that owns the source job, because job work directories and provider session state are worker-local
- the worker host needs Git, SSH repo access, and the selected agent runtime tools

## Preflight Checks

Run the shared checks in [Operator preflight reference](./sniptail-preflight-reference.md).

For split deployment, interpret them strictly:

- split deployment requires `REDIS_URL` on both sides
- local Codex worker mode requires `codex --version` to succeed on the worker host
- local Copilot worker mode requires `copilot --version` to succeed on the worker host
- local OpenCode worker mode requires `opencode --version` to succeed on the worker host
- ACP worker mode requires the configured ACP command or preset CLI to be available on the worker host
- Docker worker mode requires `docker --version` to succeed on the worker host
- repository provider requirements come from [Repository provider reference](./sniptail-repo-providers-reference.md)

If a required check fails, do not continue with split deployment until it is fixed.

## Common Configuration Pattern

Bot side:

- `sniptail bot`
- `queue_driver = "redis"`
- set `REDIS_URL`

Worker side:

- `sniptail worker`
- `queue_driver = "redis"`
- set `REDIS_URL`
- choose a shared `[registry]` backend:
  - `[registry].db = "redis"` with `SNIPTAIL_REGISTRY_REDIS_URL` or `REDIS_URL`
  - `[registry].db = "pg"` with `SNIPTAIL_REGISTRY_PG_URL`

Bot and worker must use the same registry backend and namespace for one deployment.

The shared registry stores worker capabilities and job ownership. In split deployments, this is what lets bots route resumed managed jobs to the original owner worker instead of publishing them to the shared jobs queue. If the owner worker is stale, resume requests fail until that worker returns or an operator clears ownership.

If Postgres is used for the registry, apply migrations before startup:

```bash
sniptail db migrate --scope bot
sniptail db migrate --scope worker
```

## Minimal Bring-Up Checklist

- both machines use compatible `.env` and TOML settings
- Slack or Discord credentials are present where the bot process runs
- Git and repository credentials are present where the worker process runs
- at least one repository exists in the catalog
- bot and worker can both reach the chosen shared backing services
