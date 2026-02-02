import { Client, GatewayIntentBits } from 'discord.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Queue } from 'bullmq';
import type { DiscordHandlerContext } from './context.js';
import { registerDiscordCommands } from './lib/commands.js';
import { registerDiscordHandlers } from './handlers.js';

export async function startDiscordBot(
  jobQueue: Queue<JobSpec>,
  bootstrapQueue: Queue<BootstrapRequest>,
  workerEventQueue: Queue<WorkerEvent>,
) {
  const config = loadBotConfig();
  if (!config.discord) {
    throw new Error(
      'Discord is not configured. Enable discord in sniptail.bot.toml and set DISCORD_BOT_TOKEN.',
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
    queue: jobQueue,
    bootstrapQueue,
    workerEventQueue,
  };

  registerDiscordHandlers(context);

  await client.login(config.discord.botToken);

  return client;
}
