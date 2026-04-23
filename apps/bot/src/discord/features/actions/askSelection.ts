import type { StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { buildAskModal } from '../../modals.js';
import {
  askSelectionByUser,
  disableDiscordSelectionReply,
  DISCORD_SELECTION_CAPTURED_MESSAGE,
  getActiveDiscordSelection,
} from '../../state.js';

export async function handleAskSelection(
  interaction: StringSelectMenuInteraction,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const repoKeys = interaction.values ?? [];
  if (!repoKeys.length) {
    await interaction.reply({ content: 'Please select at least one repository.', ephemeral: true });
    return;
  }

  const { selection: currentSelection, expiredSelection } = getActiveDiscordSelection(
    askSelectionByUser,
    interaction.user.id,
  );
  if (expiredSelection) {
    await disableDiscordSelectionReply(
      interaction,
      expiredSelection,
      'Repository selection expired. Please rerun the ask command.',
      'ask',
    );
    await interaction.reply({
      content: 'Repository selection expired. Please run the ask command again.',
      ephemeral: true,
    });
    return;
  }

  askSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
    ...(currentSelection?.selectorMessageId
      ? { selectorMessageId: currentSelection.selectorMessageId }
      : {}),
    ...(currentSelection?.resumeFromJobId
      ? { resumeFromJobId: currentSelection.resumeFromJobId }
      : {}),
    ...(currentSelection?.contextAttachments?.length
      ? { contextAttachments: currentSelection.contextAttachments }
      : {}),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildAskModal(
    config.botName,
    repoKeys,
    baseBranch,
    currentSelection?.resumeFromJobId,
  );
  await interaction.showModal(modal);
  await disableDiscordSelectionReply(
    interaction,
    currentSelection,
    DISCORD_SELECTION_CAPTURED_MESSAGE,
    'ask',
  );
}
