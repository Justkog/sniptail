import { Client, GatewayIntentBits } from 'discord.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import type { DiscordHandlerContext } from './context.js';
import { registerDiscordCommands } from './lib/commands.js';
import { registerDiscordHandlers } from './handlers.js';
import { PermissionsRuntimeService } from '../permissions/permissionsRuntimeService.js';

export async function startDiscordBot(queueRuntime: QueueTransportRuntime) {
  const config = loadBotConfig();
  if (!config.discord) {
    throw new Error(
      'Discord is not configured. Enable channels.discord in sniptail.bot.toml and set DISCORD_BOT_TOKEN.',
    );
  }

  await registerDiscordCommands(
    config.discord.appId,
    config.discord.botToken,
    config.botName,
    config.discord.guildId,
  );

  logger.info('Registered Discord slash commands');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const context: DiscordHandlerContext = {
    client,
    config,
    queueRuntime,
    permissions: new PermissionsRuntimeService({
      config,
      queueRuntime,
    }),
  };

  registerDiscordHandlers(context);

  await client.login(config.discord.botToken);

  return client;
}
