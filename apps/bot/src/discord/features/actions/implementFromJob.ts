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
  buildImplementFromJobContinueButtonCustomId,
  buildImplementModal,
  buildImplementRepoSelect,
} from '../../modals.js';
import {
  createDiscordSelectionToken,
  implementFromJobSelectionByToken,
  implementSelectionByUser,
  setFromJobSelectionWithCap,
} from '../../state.js';

async function openImplementModalFromSelection(
  interaction: ButtonInteraction,
  config: BotConfig,
  selectionToken: string,
) {
  const selection = implementFromJobSelectionByToken.get(selectionToken);
  if (!selection || selection.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the implement action again.',
      ephemeral: true,
    });
    return;
  }
  implementFromJobSelectionByToken.delete(selectionToken);

  const baseSelection = {
    repoKeys: selection.repoKeys,
    requestedAt: Date.now(),
    ...(selection.resumeFromJobId ? { resumeFromJobId: selection.resumeFromJobId } : {}),
  };
  implementSelectionByUser.set(interaction.user.id, baseSelection);

  const repoKeys = selection.repoKeys;
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the implement action again.',
      ephemeral: true,
    });
    return;
  }

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildImplementModal(
    config.botName,
    repoKeys,
    baseBranch,
    selection?.resumeFromJobId,
  );
  await interaction.showModal(modal);
}

export async function handleImplementFromJobButton(
  interaction: ButtonInteraction,
  jobId: string,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for implement from job');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: `Unable to open implement modal for job ${jobId}.`,
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
  setFromJobSelectionWithCap(implementFromJobSelectionByToken, selectionToken, {
    userId: interaction.user.id,
    ...baseSelection,
  });
  implementSelectionByUser.set(interaction.user.id, baseSelection);

  const allowlistRepoKeys = Object.keys(config.repoAllowlist);
  const continueButton = new ButtonBuilder()
    .setCustomId(buildImplementFromJobContinueButtonCustomId(selectionToken))
    .setStyle(ButtonStyle.Primary)
    .setLabel('Use same repos');
  const components: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton),
  ];

  let content = 'Use the same repositories for this implement job, or choose a different repo set.';
  if (allowlistRepoKeys.length <= 25) {
    components.unshift(buildImplementRepoSelect(allowlistRepoKeys, repoKeys));
  } else {
    content =
      'Use the same repositories for this implement job. Changing repos is unavailable in Discord because the allowlist exceeds 25 repositories.';
  }

  await interaction.reply({
    content,
    components,
    ephemeral: true,
  });
}

export async function handleImplementFromJobContinueButton(
  interaction: ButtonInteraction,
  config: BotConfig,
  selectionToken: string,
) {
  await refreshRepoAllowlist(config);
  await openImplementModalFromSelection(interaction, config, selectionToken);
}
