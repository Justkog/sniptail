import type { StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { buildPlanModal } from '../../modals.js';
import { planSelectionByUser } from '../../state.js';

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
  planSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
    ...(currentSelection?.contextAttachments?.length
      ? { contextAttachments: currentSelection.contextAttachments }
      : {}),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildPlanModal(config.botName, repoKeys, baseBranch);
  await interaction.showModal(modal);
}
