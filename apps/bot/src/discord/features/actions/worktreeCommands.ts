import type { ButtonInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import {
  findLatestJobByChannelThreadAndTypes,
  loadJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { buildWorktreeCommandsText } from '../../../slack/lib/worktree.js';

export async function handleWorktreeCommandsButton(
  interaction: ButtonInteraction,
  jobId: string,
  config: BotConfig,
) {
  refreshRepoAllowlist(config);

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for worktree commands');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  if (!repoKeys.length || !record?.job?.gitRef) {
    await interaction.reply({
      content: `Unable to build worktree commands for job ${jobId}.`,
      ephemeral: true,
    });
    return;
  }

  const channelId = interaction.channelId;
  const threadId = interaction.channel?.isThread()
    ? interaction.channelId
    : record?.job?.channel?.threadId;

  const latestImplement = threadId
    ? await findLatestJobByChannelThreadAndTypes('discord', channelId, threadId, [
        'IMPLEMENT',
      ]).catch((err) => {
        logger.warn({ err, jobId }, 'Failed to resolve latest implement job');
        return undefined;
      })
    : undefined;

  const targetRepoKeys =
    latestImplement?.job?.repoKeys?.length && latestImplement.job.repoKeys.length
      ? latestImplement.job.repoKeys
      : repoKeys;

  const messageText = latestImplement
    ? buildWorktreeCommandsText(config, {
        mode: 'branch',
        jobId: latestImplement.job.jobId,
        repoKeys: targetRepoKeys,
        ...(latestImplement.branchByRepo ? { branchByRepo: latestImplement.branchByRepo } : {}),
      })
    : buildWorktreeCommandsText(config, {
        mode: 'base',
        jobId: record.job.jobId,
        repoKeys: targetRepoKeys,
        baseRef: record.job.gitRef,
      });

  await interaction.reply({
    content: messageText,
    ephemeral: true,
  });
}
