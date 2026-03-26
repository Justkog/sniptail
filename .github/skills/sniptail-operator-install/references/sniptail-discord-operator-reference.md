# Sniptail Discord Operator Reference

Use this reference when the user wants Sniptail connected to Discord.

## Required Discord Pieces

- a Discord application
- a Discord bot token
- the Discord application ID
- the message content intent enabled in the Discord developer portal

## Recommended Flow

1. Create a Discord application in the developer portal.
2. Add a bot user.
3. Copy the bot token into `DISCORD_BOT_TOKEN`.
4. Copy the application ID and place it in the Discord channel config.
5. Enable the message content intent.
6. Invite the bot to the target server with message, thread, and attachment permissions.

## Bot Config

Enable Discord in `~/.sniptail/current/sniptail.bot.toml`:

```toml
[channels.discord]
enabled = true
app_id = "123456789012345678"
```

Optional values:

- `guild_id` for faster server-scoped command registration during setup
- `channel_ids` to restrict where Sniptail is allowed to respond

## Important Discord Facts

- mentions will not work without the message content intent
- thread creation requires the relevant thread permissions
- if thread creation is unavailable, Sniptail falls back to replying in the channel

## Minimal Verification

- start Sniptail
- run `/sniptail-ask`
- mention the bot in an allowed channel

If mentions do not trigger, check the message content intent and channel permissions first.