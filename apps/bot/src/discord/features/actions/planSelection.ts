import type { StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { buildPlanModal } from '../../modals.js';
import { planSelectionByUser } from '../../state.js';
import { tryDeleteDiscordSelectorReply } from '../../lib/selectorReplyCleanup.js';

export async function handlePlanSelection(
  interaction: StringSelectMenuInteraction,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const repoKeys = interaction.values ?? [];
  if (!repoKeys.length) {
    await interaction.reply({ content: 'Please select at least one repository.', ephemeral: true });
    return;
  }

  const currentSelection = planSelectionByUser.get(interaction.user.id);
  const nextSelection = {
    repoKeys,
    requestedAt: Date.now(),
    ...(currentSelection?.resumeFromJobId
      ? { resumeFromJobId: currentSelection.resumeFromJobId }
      : {}),
    ...(currentSelection?.contextAttachments?.length
      ? { contextAttachments: currentSelection.contextAttachments }
      : {}),
    ...(currentSelection?.selectorReply ? { selectorReply: currentSelection.selectorReply } : {}),
  };
  planSelectionByUser.set(interaction.user.id, nextSelection);

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildPlanModal(
    config.botName,
    repoKeys,
    baseBranch,
    currentSelection?.resumeFromJobId,
  );
  await interaction.showModal(modal);
  if (
    await tryDeleteDiscordSelectorReply(interaction.client, currentSelection?.selectorReply, {
      action: 'plan',
      userId: interaction.user.id,
    })
  ) {
    const selectionWithoutReply = { ...nextSelection };
    delete selectionWithoutReply.selectorReply;
    planSelectionByUser.set(interaction.user.id, selectionWithoutReply);
  }
}
