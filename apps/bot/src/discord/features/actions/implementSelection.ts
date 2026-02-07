import type { StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { buildImplementModal } from '../../modals.js';
import { implementSelectionByUser } from '../../state.js';

export async function handleImplementSelection(
  interaction: StringSelectMenuInteraction,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const repoKeys = interaction.values ?? [];
  if (!repoKeys.length) {
    await interaction.reply({ content: 'Please select at least one repository.', ephemeral: true });
    return;
  }

  implementSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildImplementModal(config.botName, repoKeys, baseBranch);
  await interaction.showModal(modal);
}
