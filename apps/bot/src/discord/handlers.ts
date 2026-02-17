import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { Events } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { parseDiscordCompletionCustomId } from '@sniptail/core/discord/components.js';
import { buildCommandNames } from './lib/commands.js';
import { isChannelAllowed } from './lib/channel.js';
import { handleAskStart } from './features/commands/ask.js';
import { handlePlanStart } from './features/commands/plan.js';
import { handleImplementStart } from './features/commands/implement.js';
import { handleBootstrapStart } from './features/commands/bootstrap.js';
import { handleUsage } from './features/commands/usage.js';
import { handleAskSelection } from './features/actions/askSelection.js';
import { handlePlanSelection } from './features/actions/planSelection.js';
import { handleImplementSelection } from './features/actions/implementSelection.js';
import { handleAnswerQuestionsButton } from './features/actions/answerQuestions.js';
import {
  handleBootstrapExtrasContinue,
  handleBootstrapExtrasSelection,
  isBootstrapContinueCustomId,
  isBootstrapExtrasCustomId,
} from './features/actions/bootstrapExtras.js';
import { handleAskModalSubmit } from './features/views/askSubmit.js';
import { handleAnswerQuestionsSubmit } from './features/views/answerQuestionsSubmit.js';
import { handlePlanModalSubmit } from './features/views/planSubmit.js';
import { handleImplementModalSubmit } from './features/views/implementSubmit.js';
import { handleBootstrapModalSubmit } from './features/views/bootstrapSubmit.js';
import { handleMention } from './features/events/mention.js';
import { handleAskFromJobButton } from './features/actions/askFromJob.js';
import {
  handleClearJobButton,
  handleClearJobCancelButton,
  handleClearJobConfirmButton,
} from './features/actions/clearJob.js';
import { handleImplementFromJobButton } from './features/actions/implementFromJob.js';
import { handleReviewFromJobButton } from './features/actions/reviewFromJob.js';
import { handleWorktreeCommandsButton } from './features/actions/worktreeCommands.js';
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
import type { DiscordHandlerContext } from './context.js';

async function replyToInteractionError(
  interaction:
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ChatInputCommandInteraction,
  message: string,
) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(message);
  } else {
    await interaction.reply(message);
  }
}

export function registerDiscordHandlers(context: DiscordHandlerContext): void {
  const { client, config, queue, bootstrapQueue, workerEventQueue } = context;
  const prefix = toSlackCommandPrefix(config.botName);
  const commandNames = buildCommandNames(prefix);

  client.once(Events.ClientReady, () => {
    logger.info(`🤖 ${config.botName} Discord bot is running`);
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const interactionParentChannelId = interaction.channel?.isThread()
      ? interaction.channel.parentId ?? undefined
      : undefined;
    if (
      !isChannelAllowed(
        config.discord?.channelIds,
        interaction.channelId,
        interactionParentChannelId,
      )
    ) {
      await interaction.reply({
        content: 'This command is not enabled in this channel.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === commandNames.implement) {
      try {
        await handleImplementStart(interaction, config);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.ask) {
      try {
        await handleAskStart(interaction, config);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.plan) {
      try {
        await handlePlanStart(interaction, config);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.bootstrap) {
      try {
        await handleBootstrapStart(interaction, config);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      if (interaction.commandName === commandNames.usage) {
        await handleUsage(interaction, workerEventQueue);
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
      if (parsed) {
        switch (parsed.action) {
          case 'askFromJob':
            await handleAskFromJobButton(interaction, parsed.jobId, config);
            return;
          case 'answerQuestions':
            try {
              await handleAnswerQuestionsButton(interaction, parsed.jobId, config);
            } catch (err) {
              logger.error({ err }, 'Discord answer questions failed');
              await interaction.reply('Something went wrong handling that action.');
            }
            return;
          case 'implementFromJob':
            await handleImplementFromJobButton(interaction, parsed.jobId, config);
            return;
          case 'reviewFromJob':
            await handleReviewFromJobButton(interaction, parsed.jobId, config, queue);
            return;
          case 'worktreeCommands':
            await handleWorktreeCommandsButton(interaction, parsed.jobId, config);
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

      if (isBootstrapContinueCustomId(interaction.customId)) {
        try {
          await handleBootstrapExtrasContinue(interaction, config);
        } catch (err) {
          logger.error({ err }, 'Discord bootstrap continue failed');
          await replyToInteractionError(interaction, 'Something went wrong handling that request.');
        }
        return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === askRepoSelectCustomId) {
      try {
        await handleAskSelection(interaction, config);
      } catch (err) {
        logger.error({ err }, 'Discord ask selection failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === planRepoSelectCustomId) {
      try {
        await handlePlanSelection(interaction, config);
      } catch (err) {
        logger.error({ err }, 'Discord plan selection failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === implementRepoSelectCustomId) {
      try {
        await handleImplementSelection(interaction, config);
      } catch (err) {
        logger.error({ err }, 'Discord implement selection failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu() && isBootstrapExtrasCustomId(interaction.customId)) {
      try {
        await handleBootstrapExtrasSelection(interaction, config);
      } catch (err) {
        logger.error({ err }, 'Discord bootstrap extras selection failed');
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === implementModalCustomId) {
      try {
        await handleImplementModalSubmit(interaction, config, queue);
      } catch (err) {
        logger.error({ err }, 'Discord implement modal submit failed');
        await replyToInteractionError(interaction, 'Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === planModalCustomId) {
      try {
        await handlePlanModalSubmit(interaction, config, queue);
      } catch (err) {
        logger.error({ err }, 'Discord plan modal submit failed');
        await replyToInteractionError(interaction, 'Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === answerQuestionsModalCustomId) {
      try {
        await handleAnswerQuestionsSubmit(interaction, config, queue);
      } catch (err) {
        logger.error({ err }, 'Discord answer questions modal submit failed');
        await replyToInteractionError(interaction, 'Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === askModalCustomId) {
      try {
        await handleAskModalSubmit(interaction, config, queue);
      } catch (err) {
        logger.error({ err }, 'Discord ask modal submit failed');
        await replyToInteractionError(interaction, 'Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === bootstrapModalCustomId) {
      try {
        await handleBootstrapModalSubmit(interaction, config, bootstrapQueue);
      } catch (err) {
        logger.error({ err }, 'Discord bootstrap modal submit failed');
        await replyToInteractionError(interaction, 'Something went wrong handling that request.');
      }
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.client.user) return;
    const messageParentChannelId = message.channel.isThread()
      ? message.channel.parentId ?? undefined
      : undefined;
    if (!isChannelAllowed(config.discord?.channelIds, message.channelId, messageParentChannelId)) {
      return;
    }

    try {
      await handleMention(message, config, queue);
    } catch (err) {
      logger.error({ err }, 'Discord mention handling failed');
    }
  });
}
