# Discord bot setup (Sniptail)

This guide walks through creating a Discord application/bot, inviting it to your server, and configuring Sniptail to use it.

Sniptail’s Discord bot:
- Registers slash commands on startup (ex: `/sniptail-ask`, `/sniptail-explore`, `/sniptail-implement`, `/sniptail-run`).
- Accepts up to 3 small context-file attachments on `/sniptail-ask`, `/sniptail-explore`, `/sniptail-plan`, and `/sniptail-implement`.
- Supports `@mention` in a channel to kick off a job, and will include supported files attached to that triggering mention message.
- Posts job results and uploads Markdown reports as file attachments.
- Tries to create a thread per job (and falls back to replying in the channel if it can’t).

## Prerequisites

- A Discord account with permission to manage a server (or access to a server admin).
- Sniptail configured and running (Redis + bot + worker). See the main `README.md` for Sniptail installation and worker setup.

## 1) Create the Discord application

1. Open the Discord Developer Portal.
2. Click **New Application** and give it a name (ex: `Sniptail`).
3. In **General Information**, copy the **Application ID** — you’ll use it as `DISCORD_APP_ID`.

## 2) Create the bot user and token

1. In your application, go to **Bot**.
2. Click **Add Bot** (if it doesn’t already exist).
3. Click **Reset Token** / **View Token** and copy it.
4. Store it as an environment variable on the machine running `apps/bot`:

```bash
export DISCORD_BOT_TOKEN="..."
```

## 3) Enable required privileged intent

Sniptail listens for message mentions and needs access to message content.

In **Bot → Privileged Gateway Intents**, enable:
- **MESSAGE CONTENT INTENT**

## 4) Invite the bot to your server

1. In the Developer Portal, go to **OAuth2 → URL Generator**.
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, pick at least:
   - View Channels
   - Send Messages
   - Read Message History
   - Add Reactions
   - Attach Files
   - Create Public Threads
   - Send Messages in Threads

Open the generated URL, pick your server, and authorize.

## 5) Collect IDs (guild + channels)

Sniptail can optionally restrict where the bot responds via an allowlist.

1. In the Discord client, enable **Developer Mode** (User Settings → Advanced → Developer Mode).
2. Copy IDs as needed:
   - **Guild ID** (server): right-click the server icon → **Copy Server ID**
   - **Channel IDs**: right-click the channel → **Copy Channel ID**
   - **Role IDs** (for group-based permissions): Server Settings → Roles → right-click role → **Copy Role ID**

## 6) Configure Sniptail

### Option A (recommended): `sniptail.bot.toml`

Edit `sniptail.bot.toml`:

```toml
[channels.discord]
enabled = true
app_id = "123456789012345678"

# Optional: register commands only in a single server for faster iteration.
guild_id = "123456789012345678"

# Optional: restrict the bot to specific channels.
# For thread mentions/commands, allowlist the parent channel ID.
channel_ids = ["123456789012345678"]
```

Then ensure `DISCORD_BOT_TOKEN` is set in the environment where you run the bot.

### Option B: environment variables

You can override TOML values with env vars:

- `SNIPTAIL_CHANNELS=discord`
- `DISCORD_APP_ID=...`
- `DISCORD_GUILD_ID=...` (optional)
- `DISCORD_CHANNEL_IDS=...` (optional, comma-separated)
- `DISCORD_BOT_TOKEN=...`

Example:

```bash
export SNIPTAIL_CHANNELS=discord
export DISCORD_APP_ID="123456789012345678"
export DISCORD_GUILD_ID="123456789012345678"
export DISCORD_CHANNEL_IDS="123456789012345678,234567890123456789"
export DISCORD_BOT_TOKEN="..."
```

## 7) Run and verify

1. Start Redis and the worker (see `README.md`).
2. Start the bot:

```bash
pnpm run dev
```

3. In a Discord channel the bot can read/write:
   - Try a slash command, e.g. `/sniptail-usage`
   - Try `/sniptail-ask` with up to 3 attachments. Attach files to the slash command itself, then complete the modal.
   - Mention the bot: `@Sniptail hello`
   - Mention the bot with files attached to that same message to include them as context for the mention job.
   - If a rule returns `require_approval`, Sniptail posts an approval message with **Approve**, **Deny**, and **Cancel** buttons in the same context.

Supported attachment types for slash commands and mention messages: PNG, JPG, GIF, WEBP, TXT, MD, JSON, YAML. Current limit: 3 files, 2 MiB each, 6 MiB total. For mentions, Sniptail only uses files attached to the triggering message itself.

## Troubleshooting

### Slash commands don’t show up

- If you didn’t set `guild_id`, commands are registered globally and Discord may take time to propagate them. During development, set `guild_id` to register server-scoped commands immediately.
- Confirm `DISCORD_APP_ID` matches the application you invited, and that `DISCORD_BOT_TOKEN` is from the same application’s bot.

### Mentions don’t trigger

- Ensure **MESSAGE CONTENT INTENT** is enabled in the Developer Portal.
- Confirm the bot has access to the channel and can read message history.

### Mention files are ignored

- Attach files directly to the same message that mentions the bot. Sniptail does not pull files from earlier thread messages or the replied-to message.
- Keep mention attachments within the current limit: up to 3 files, 2 MiB each, 6 MiB total.

### Threads aren’t created

- Grant **Create Public Threads** and **Send Messages in Threads** permissions, or Sniptail will fall back to replying in the channel.
