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
  buildExploreModal,
  buildExploreFromJobContinueButtonCustomId,
  buildExploreRepoSelect,
} from '../../modals.js';
import {
  createDiscordSelectionToken,
  exploreFromJobSelectionByToken,
  exploreSelectionByUser,
} from '../../state.js';

async function openExploreModalFromSelection(
  interaction: ButtonInteraction,
  config: BotConfig,
  selectionToken: string,
) {
  const selection = exploreFromJobSelectionByToken.get(selectionToken);
  if (!selection || selection.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the explore action again.',
      ephemeral: true,
    });
    return;
  }
  exploreFromJobSelectionByToken.delete(selectionToken);

  exploreSelectionByUser.set(interaction.user.id, {
    repoKeys: selection.repoKeys,
    requestedAt: Date.now(),
    ...(selection.resumeFromJobId ? { resumeFromJobId: selection.resumeFromJobId } : {}),
  });

  const repoKeys = selection.repoKeys;
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the explore action again.',
      ephemeral: true,
    });
    return;
  }

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildExploreModal(
    config.botName,
    repoKeys,
    baseBranch,
    selection?.resumeFromJobId,
  );
  await interaction.showModal(modal);
}

export async function handleDiscordExploreFromJobButton(
  interaction: ButtonInteraction,
  jobId: string,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for explore from job');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: `Unable to open explore modal for job ${jobId}.`,
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
  exploreFromJobSelectionByToken.set(selectionToken, {
    userId: interaction.user.id,
    repoKeys,
    requestedAt: Date.now(),
    resumeFromJobId: jobId,
  });
  exploreSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
    resumeFromJobId: jobId,
  });

  const allowlistRepoKeys = Object.keys(config.repoAllowlist);
  const continueButton = new ButtonBuilder()
    .setCustomId(buildExploreFromJobContinueButtonCustomId(selectionToken))
    .setStyle(ButtonStyle.Primary)
    .setLabel('Use same repos');
  const components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton),
  ];

  let content = 'Use the same repositories for this explore job, or choose a different repo set.';
  if (allowlistRepoKeys.length <= 25) {
    components.unshift(buildExploreRepoSelect(allowlistRepoKeys, repoKeys));
  } else {
    content =
      'Use the same repositories for this explore job. Changing repos is unavailable in Discord because the allowlist exceeds 25 repositories.';
  }

  await interaction.reply({
    content,
    components,
    ephemeral: true,
  });
}

export async function handleDiscordExploreFromJobContinueButton(
  interaction: ButtonInteraction,
  config: BotConfig,
  selectionToken: string,
) {
  await refreshRepoAllowlist(config);
  await openExploreModalFromSelection(interaction, config, selectionToken);
}
