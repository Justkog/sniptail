import type { ButtonInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { buildAskModal } from '../../modals.js';
import { askSelectionByUser } from '../../state.js';

export async function handleAskFromJobButton(
  interaction: ButtonInteraction,
  jobId: string,
  config: BotConfig,
) {
  refreshRepoAllowlist(config);

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for ask from job');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: `Unable to open ask modal for job ${jobId}.`,
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

  askSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildAskModal(config.botName, repoKeys, baseBranch, jobId);
  await interaction.showModal(modal);
}
