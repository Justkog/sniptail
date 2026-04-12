# Telegram bot setup (Sniptail)

This guide covers the Telegram MVP runtime in Sniptail.

Sniptail's Telegram bot:
- accepts `/ask`, `/explore`, `/plan`, `/implement`, `/review`, `/run`, `/usage`, and `/clearbefore`
- supports direct-message mention-style requests by treating freeform DM text as a mention job
- uses inline keyboards plus edited messages for guided ask/explore/plan/implement/review flows
- posts worker completions and report uploads back into the same chat, replying to the triggering message when possible

## 1) Create the bot

1. Open Telegram and talk to `@BotFather`.
2. Run `/newbot`.
3. Copy the bot token.
4. Set it where the bot runtime can read it:

```bash
export TELEGRAM_BOT_TOKEN="123456:telegram-token"
```

## 2) Enable Telegram in `sniptail.bot.toml`

```toml
[channels.telegram]
enabled = true

# Optional: restrict Sniptail to specific chat IDs.
# chat_ids = ["123456789", "-1001234567890"]
```

## 3) Start the runtimes

```bash
pnpm run dev
```

Or in split mode:

```bash
pnpm --filter @sniptail/bot start
pnpm --filter @sniptail/worker start
```

## 4) Try the Telegram commands

Examples:

```text
/usage
/ask sniptail | Summarize how the worker publishes completion messages.
/plan sniptail | Add a new worker health check command.
/run sniptail | ci-check
```

If you omit the arguments for `/ask`, `/explore`, `/plan`, `/implement`, or `/review`, Sniptail starts a guided Telegram flow that edits the same message in place and lets you cancel with an inline button.

## Notes

- Telegram in this MVP uses provider-local edited-message flows for guided interactions. Worker-originated completions still use normal reply/post behavior.
- Telegram approval prompts use inline buttons and edit the approval message after approve/deny/cancel.
- Telegram group/role-based permission subjects are not implemented in this MVP. User-based rules work best.
