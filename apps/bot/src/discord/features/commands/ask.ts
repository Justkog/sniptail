import type { ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { buildAskModal, buildAskRepoSelect } from '../../modals.js';
import { askSelectionByUser } from '../../state.js';

export async function handleAskStart(interaction: ChatInputCommandInteraction, config: BotConfig) {
  await refreshRepoAllowlist(config);

  const repoKeys = Object.keys(config.repoAllowlist);
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'No repositories are allowlisted yet. Update the allowlist and try again.',
      ephemeral: true,
    });
    return;
  }
  if (repoKeys.length === 1) {
    askSelectionByUser.set(interaction.user.id, {
      repoKeys,
      requestedAt: Date.now(),
    });
    const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const modal = buildAskModal(config.botName, repoKeys, baseBranch);
    await interaction.showModal(modal);
    return;
  }
  if (repoKeys.length > 25) {
    await interaction.reply({
      content:
        'Too many repositories to list in Discord (max 25). Use Slack or narrow the allowlist.',
      ephemeral: true,
    });
    return;
  }

  const row = buildAskRepoSelect(repoKeys);
  await interaction.reply({
    content: 'Select repositories for your question.',
    components: [row],
    ephemeral: true,
  });
}
