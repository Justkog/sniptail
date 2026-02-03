# Slack bot setup (Sniptail)

This guide walks through creating a Slack app for Sniptail, enabling Socket Mode, configuring required permissions, and setting the environment variables Sniptail expects.

Sniptail’s Slack bot:
- Runs in **Socket Mode** (no public HTTP endpoint required).
- Supports slash commands (ex: `/sniptail-ask`, `/sniptail-implement`).
- Supports `@Sniptail …` mentions in channels (`app_mention` events).
- Uses interactive components + modals (interactivity enabled).
- Uploads Markdown reports as files.

## Prerequisites

- A Slack workspace where you can install apps.
- Sniptail configured and running (Redis + bot + worker). See the main `README.md` for Sniptail installation and worker setup.

## 1) Pick your bot name + command prefix

Sniptail derives Slack command names from the configured bot name.

Examples:
- Bot name `Sniptail` → `/sniptail-ask`, `/sniptail-implement`, etc.
- Bot name `My Bot` → `/my-bot-ask`, `/my-bot-implement`, etc.

Make sure these match:
- Your Slack app manifest’s command names
- `sniptail.bot.toml` `[bot].bot_name`

## 2) Generate the Slack app manifest

From the repo root:

```bash
pnpm run slack:manifest "My Bot"
```

This writes `slack-app-manifest.yaml` in the repo root.

## 3) Create the Slack app from the manifest

1. Go to **Slack API → Your Apps**.
2. Click **Create New App**.
3. Choose **From an app manifest**.
4. Pick your workspace, then paste in `slack-app-manifest.yaml`.
5. Create the app.

## 4) Enable Socket Mode + create an app-level token

Sniptail uses Socket Mode, which requires an **app-level token**.

1. In your app settings, go to **Socket Mode** and enable it.
2. Go to **Basic Information → App-Level Tokens**.
3. Create a token (commonly named `Sniptail Socket Mode`) with scope:
   - `connections:write`
4. Copy it — you’ll use it as `SLACK_APP_TOKEN` (typically starts with `xapp-`).

## 5) Install the app to your workspace (bot token)

1. Go to **OAuth & Permissions**.
2. Confirm the bot scopes from the manifest are present (Sniptail needs things like `commands`, `chat:write`, `files:write`, `app_mentions:read`, history scopes, etc.).
3. Click **Install to Workspace** (or **Reinstall to Workspace** after changes).
4. Copy the **Bot User OAuth Token** — you’ll use it as `SLACK_BOT_TOKEN` (typically starts with `xoxb-`).

## 6) Get the signing secret

1. Go to **Basic Information → App Credentials**.
2. Copy the **Signing Secret** — you’ll use it as `SLACK_SIGNING_SECRET`.

## 7) Configure Sniptail (enable Slack)

### Option A (recommended): `sniptail.bot.toml`

Edit `sniptail.bot.toml`:

```toml
[slack]
enabled = true
```

Also ensure the bot name matches what you used for the manifest:

```toml
[bot]
bot_name = "My Bot"
```

Then set environment variables on the machine running `apps/bot`:

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
export SLACK_SIGNING_SECRET="..."
```

### Option B: environment variables

You can enable Slack and supply credentials via env vars:

- `SLACK_ENABLED=1`
- `SLACK_BOT_TOKEN=...`
- `SLACK_APP_TOKEN=...`
- `SLACK_SIGNING_SECRET=...`

## 8) Run and verify

1. Start Redis and the worker (see `README.md`).
2. Start the bot:

```bash
pnpm run dev
```

3. In Slack:
   - Try `/sniptail-usage` (or your custom prefix)
   - Mention the bot in a channel it’s in: `@Sniptail hello`

## Troubleshooting

### “No bot providers enabled”

- Enable Slack in `sniptail.bot.toml` (`[slack].enabled = true`) or set `SLACK_ENABLED=1`.

### Bot connects but slash commands don’t work

- Reinstall the app after editing the manifest or scopes.
- Ensure the manifest command prefix matches your configured `[bot].bot_name`.

### Socket Mode errors / disconnects

- Confirm Socket Mode is enabled for the app.
- Confirm `SLACK_APP_TOKEN` is an **app-level token** with `connections:write`.

### “Slack is not configured…” at startup

- Ensure `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `SLACK_SIGNING_SECRET` are set in the environment where you run `apps/bot`.

