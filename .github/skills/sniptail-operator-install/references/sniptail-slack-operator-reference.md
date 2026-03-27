# Sniptail Slack Operator Reference

Use this reference when the user wants Sniptail connected to Slack.

## Required Slack Pieces

- a Slack workspace where apps can be installed
- a Slack app running in Socket Mode
- a bot token
- an app-level token with `connections:write`
- a signing secret

## Recommended Flow

1. Choose the final bot display name first.
2. Generate the manifest with the installed CLI:

```bash
sniptail slack-manifest --name "My Bot"
```

3. Create the Slack app from the generated manifest.
4. Enable Socket Mode.
5. Create the app-level token and record it as `SLACK_APP_TOKEN`.
6. Install or reinstall the app to the workspace and record the bot token as `SLACK_BOT_TOKEN`.
7. Copy the signing secret into `SLACK_SIGNING_SECRET`.

## Bot Config

Enable Slack in `~/.sniptail/current/sniptail.bot.toml`:

```toml
[channels.slack]
enabled = true
```

Ensure the bot name matches the manifest naming convention:

```toml
[bot]
bot_name = "My Bot"
```

## Important Slack Facts

- Sniptail Slack support uses Socket Mode.
- The app-level token is not the same as the bot token.
- Slash command names depend on the configured bot name.
- After changing manifest scopes or commands, reinstall the app.

## Minimal Verification

- start Sniptail
- run `/sniptail-usage` or the equivalent command prefix for the chosen bot name
- mention the bot in a channel it can read

If commands do not appear, verify that the manifest command names still match the configured bot name.