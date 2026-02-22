import type { ButtonInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { buildExploreModal } from '../../modals.js';
import { exploreSelectionByUser } from '../../state.js';

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

  exploreSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildExploreModal(config.botName, repoKeys, baseBranch, jobId);
  await interaction.showModal(modal);
}
