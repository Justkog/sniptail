import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Queue } from 'bullmq';
import { parseDiscordCompletionCustomId } from '@sniptail/core/discord/components.js';
import { registerDiscordCommands, buildCommandNames } from './lib/commands.js';
import { isChannelAllowed } from './lib/channel.js';
import { handleAskStart } from './features/commands/ask.js';
import { handlePlanStart } from './features/commands/plan.js';
import { handleImplementStart } from './features/commands/implement.js';
import { handleBootstrapStart } from './features/commands/bootstrap.js';
import { handleUsage } from './features/commands/usage.js';
import { handleAskSelection } from './features/actions/askSelection.js';
import { handlePlanSelection } from './features/actions/planSelection.js';
import { handleImplementSelection } from './features/actions/implementSelection.js';
import { handleAnswerQuestionsButton } from './features/actions/completionButtons.js';
import { handleAskModalSubmit } from './features/views/askSubmit.js';
import { handleAnswerQuestionsSubmit } from './features/views/answerQuestionsSubmit.js';
import { handlePlanModalSubmit } from './features/views/planSubmit.js';
import { handleImplementModalSubmit } from './features/views/implementSubmit.js';
import { handleBootstrapModalSubmit } from './features/views/bootstrapSubmit.js';
import { handleMention } from './features/events/mention.js';
import {
  handleAskFromJobButton,
  handleClearJobButton,
  handleClearJobCancelButton,
  handleClearJobConfirmButton,
  handleImplementFromJobButton,
  handleWorktreeCommandsButton,
} from './features/actions/completionButtons.js';
import {
  askModalCustomId,
  askRepoSelectCustomId,
  answerQuestionsModalCustomId,
  planRepoSelectCustomId,
  bootstrapModalCustomId,
  implementModalCustomId,
  planModalCustomId,
  implementRepoSelectCustomId,
} from './modals.js';

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
    config.discord.guildId,
    config.botName,
  );

  logger.info('Registered Discord slash commands');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const prefix = toSlackCommandPrefix(config.botName);
  const commandNames = buildCommandNames(prefix);

  client.once(Events.ClientReady, () => {
    logger.info(`🤖 ${config.botName} Discord bot is running`);
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (!isChannelAllowed(config.discord?.channelIds, interaction.channelId)) {
      await interaction.reply({
        content: 'This command is not enabled in this channel.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === commandNames.implement) {
      try {
        await handleImplementStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.ask) {
      try {
        await handleAskStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.plan) {
      try {
        await handlePlanStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.bootstrap) {
      try {
        await handleBootstrapStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      if (interaction.commandName === commandNames.usage) {
        await handleUsage(interaction);
      }
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, 'Discord command failed');
      await interaction.editReply('Something went wrong handling that command.');
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      const parsed = parseDiscordCompletionCustomId(interaction.customId);
      if (!parsed) return;
      switch (parsed.action) {
        case 'askFromJob':
          await handleAskFromJobButton(interaction, parsed.jobId);
          return;
        case 'answerQuestions':
          try {
            await handleAnswerQuestionsButton(interaction, parsed.jobId);
          } catch (err) {
            logger.error({ err }, 'Discord answer questions failed');
            await interaction.reply('Something went wrong handling that action.');
          }
          return;
        case 'implementFromJob':
          await handleImplementFromJobButton(interaction, parsed.jobId);
          return;
        case 'worktreeCommands':
          await handleWorktreeCommandsButton(interaction, parsed.jobId);
          return;
        case 'clearJob':
          await handleClearJobButton(interaction, parsed.jobId);
          return;
        case 'clearJobConfirm':
          await handleClearJobConfirmButton(interaction, parsed.jobId, workerEventQueue);
          return;
        case 'clearJobCancel':
          await handleClearJobCancelButton(interaction, parsed.jobId);
          return;
        default:
          return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === askRepoSelectCustomId) {
      try {
        await handleAskSelection(interaction);
      } catch (err) {
        logger.error({ err }, 'Discord ask selection failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === planRepoSelectCustomId) {
      try {
        await handlePlanSelection(interaction);
      } catch (err) {
        logger.error({ err }, 'Discord plan selection failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === implementRepoSelectCustomId) {
      try {
        await handleImplementSelection(interaction);
      } catch (err) {
        logger.error({ err }, 'Discord implement selection failed');
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === implementModalCustomId) {
      try {
        await handleImplementModalSubmit(interaction, jobQueue);
      } catch (err) {
        logger.error({ err }, 'Discord implement modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === planModalCustomId) {
      try {
        await handlePlanModalSubmit(interaction, jobQueue);
      } catch (err) {
        logger.error({ err }, 'Discord plan modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === answerQuestionsModalCustomId) {
      try {
        await handleAnswerQuestionsSubmit(interaction, jobQueue);
      } catch (err) {
        logger.error({ err }, 'Discord answer questions modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === askModalCustomId) {
      try {
        await handleAskModalSubmit(interaction, jobQueue);
      } catch (err) {
        logger.error({ err }, 'Discord ask modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === bootstrapModalCustomId) {
      try {
        await handleBootstrapModalSubmit(interaction, bootstrapQueue);
      } catch (err) {
        logger.error({ err }, 'Discord bootstrap modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.client.user) return;
    if (!isChannelAllowed(config.discord?.channelIds, message.channelId)) return;

    try {
      await handleMention(message, jobQueue);
    } catch (err) {
      logger.error({ err }, 'Discord mention handling failed');
    }
  });

  await client.login(config.discord.botToken);

  return client;
}
