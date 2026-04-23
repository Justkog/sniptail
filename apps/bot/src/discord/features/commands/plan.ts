import type { ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { buildPlanModal, buildPlanRepoSelect } from '../../modals.js';
import { planSelectionByUser, storeDiscordSelectionReplyId } from '../../state.js';
import { getDiscordCommandContextAttachments } from '../../lib/discordContextFiles.js';

export async function handlePlanStart(interaction: ChatInputCommandInteraction, config: BotConfig) {
  await refreshRepoAllowlist(config);
  const contextAttachments = getDiscordCommandContextAttachments(interaction);

  const repoKeys = Object.keys(config.repoAllowlist);
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'No repositories are allowlisted yet. Update the allowlist and try again.',
      ephemeral: true,
    });
    return;
  }
  if (repoKeys.length === 1) {
    planSelectionByUser.set(interaction.user.id, {
      repoKeys,
      requestedAt: Date.now(),
      ...(contextAttachments.length ? { contextAttachments } : {}),
    });
    const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const modal = buildPlanModal(config.botName, repoKeys, baseBranch);
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

  planSelectionByUser.set(interaction.user.id, {
    repoKeys: [],
    requestedAt: Date.now(),
    ...(contextAttachments.length ? { contextAttachments } : {}),
  });

  const row = buildPlanRepoSelect(repoKeys);
  const response = await interaction.reply({
    content: 'Select repositories for your plan.',
    components: [row],
    ephemeral: true,
    withResponse: true,
  });
  storeDiscordSelectionReplyId(interaction, planSelectionByUser, 'plan', response);
}
