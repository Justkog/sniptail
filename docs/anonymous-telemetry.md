# Anonymous telemetry

Sniptail sends minimal anonymous usage events to PostHog by default. The purpose is to measure OSS adoption and understand which high-level runtime and command categories are used.

Telemetry is best-effort. A telemetry initialization, capture, network, or shutdown failure never changes a bot response, job result, or process exit status.

## Disable telemetry

Disable telemetry for all bot, worker, local, and CLI processes:

```bash
SNIPTAIL_TELEMETRY_DISABLED=1
```

Or disable it in both runtime configuration files:

```toml
[core]
telemetry = false
```

The environment kill switch takes precedence over TOML and programmatic runtime options. When telemetry is disabled before startup, Sniptail does not initialize PostHog or read or create the installation ID.

## Events and properties

Sniptail sends two event types:

- `sniptail_runtime_started`
- `sniptail_command_completed`

Common properties:

- `sniptail_version`
- `runtime_mode`: `bot`, `worker`, `local`, or `cli`
- `platform`: the coarse Node.js operating-system platform
- `telemetry_schema_version`
- `$process_person_profile: false`

Every capture also sets PostHog's server-side `disableGeoip` option.

Runtime events may include `channel_providers`, limited to enabled provider types such as `slack`, `discord`, and `telegram`.

Command completion events include:

- `command_category`: `ask`, `explore`, `plan`, `review`, `implement`, `run`, `mention`, `bootstrap`, or `agent_session`
- `provider_type`: `codex`, `copilot`, `opencode`, `acp`, or `none`
- `channel_provider`: `slack`, `discord`, or `telegram`, when applicable
- `status`: `success` or `failure`
- `duration_bucket`: `<1s`, `1-10s`, `10-60s`, `1-5m`, `5-30m`, or `30m+`

No arbitrary or free-form event properties are accepted by the telemetry API.

## Data that is never collected

Sniptail telemetry does not collect:

- Prompts, responses, code, diffs, reports, plans, or generated artifacts
- Repository names, keys, URLs, branches, file names, or file paths
- Usernames, user IDs, channel names, channel IDs, job IDs, or session IDs
- Message contents, command parameters, action IDs, or error messages
- Model names, tokens, credentials, environment variables, or secrets
- IP-derived geolocation or PostHog person profiles

Sniptail does not call PostHog `identify`, use frontend autocapture, enable exception autocapture, record sessions, or use PostHog feature flags.

## Anonymous installation ID

Enabled telemetry uses a random UUID generated with `crypto.randomUUID()`. It is stored at:

```text
~/.sniptail/telemetry/installation-id
```

The ID is not derived from a username, hostname, network address, repository, channel, credential, or other machine attribute. It is used only as the PostHog event `distinctId`, with person-profile processing disabled.

Deleting the file creates a new anonymous installation ID on the next telemetry-enabled run. If the file cannot be read or written, Sniptail uses a process-local random UUID instead. Multi-machine deployments therefore count each machine and OS account as a separate anonymous installation.

## PostHog configuration

The public PostHog project ingestion key and HTTPS ingestion host are committed in `packages/core/src/telemetry/posthogTelemetryConfig.ts`. A project ingestion key is intended for event submission and is not a PostHog personal API key.

Operators cannot configure the key or host through environment variables or TOML. Personal API keys must never be added to this file.
