import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type StringSelectMenuBuilder,
  type ButtonInteraction,
} from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import {
  buildPlanFromJobContinueButtonCustomId,
  buildPlanModal,
  buildPlanRepoSelect,
} from '../../modals.js';
import {
  createDiscordSelectionToken,
  planFromJobSelectionByToken,
  planSelectionByUser,
} from '../../state.js';

async function openPlanModalFromSelection(
  interaction: ButtonInteraction,
  config: BotConfig,
  selectionToken: string,
) {
  const selection = planFromJobSelectionByToken.get(selectionToken);
  if (!selection || selection.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the plan action again.',
      ephemeral: true,
    });
    return;
  }
  planFromJobSelectionByToken.delete(selectionToken);

  const baseSelection = {
    repoKeys: selection.repoKeys,
    requestedAt: Date.now(),
    ...(selection.resumeFromJobId ? { resumeFromJobId: selection.resumeFromJobId } : {}),
  };
  planSelectionByUser.set(interaction.user.id, baseSelection);

  const repoKeys = selection.repoKeys;
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the plan action again.',
      ephemeral: true,
    });
    return;
  }

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildPlanModal(config.botName, repoKeys, baseBranch, selection?.resumeFromJobId);
  await interaction.showModal(modal);
}

export async function handlePlanFromJobButton(
  interaction: ButtonInteraction,
  jobId: string,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for plan from job');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: `Unable to open plan modal for job ${jobId}.`,
      ephemeral: true,
    });
    return;
  }

  const unknownRepos = repoKeys.filter((key) => !config.repoAllowlist[key]);
  if (unknownRepos.length) {
    await interaction.reply({
      content: `Unknown repo keys: ${unknownRepos.join(', ')}. Update the allowlist and try again.`,
      ephemeral: true,
    });
    return;
  }

  const selectionToken = createDiscordSelectionToken();
  const baseSelection = {
    repoKeys,
    requestedAt: Date.now(),
    resumeFromJobId: jobId,
  };
  planFromJobSelectionByToken.set(selectionToken, {
    userId: interaction.user.id,
    ...baseSelection,
  });
  planSelectionByUser.set(interaction.user.id, baseSelection);

  const allowlistRepoKeys = Object.keys(config.repoAllowlist);
  const continueButton = new ButtonBuilder()
    .setCustomId(buildPlanFromJobContinueButtonCustomId(selectionToken))
    .setStyle(ButtonStyle.Primary)
    .setLabel('Use same repos');
  const components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton),
  ];

  let content = 'Use the same repositories for this plan job, or choose a different repo set.';
  if (allowlistRepoKeys.length <= 25) {
    components.unshift(buildPlanRepoSelect(allowlistRepoKeys, repoKeys));
  } else {
    content =
      'Use the same repositories for this plan job. Changing repos is unavailable in Discord because the allowlist exceeds 25 repositories.';
  }

  await interaction.reply({
    content,
    components,
    ephemeral: true,
  });
}

export async function handlePlanFromJobContinueButton(
  interaction: ButtonInteraction,
  config: BotConfig,
  selectionToken: string,
) {
  await refreshRepoAllowlist(config);
  await openPlanModalFromSelection(interaction, config, selectionToken);
}
