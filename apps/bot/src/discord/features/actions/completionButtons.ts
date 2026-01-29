import type { ButtonInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import {
  findLatestJobByChannelThreadAndTypes,
  loadJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import {
  buildDiscordClearJobConfirmComponents,
} from '@sniptail/core/discord/components.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { buildAskModal, buildImplementModal } from '../../modals.js';
import { askSelectionByUser, implementSelectionByUser } from '../../state.js';
import { buildWorktreeCommandsText } from '../../../slack/lib/worktree.js';

export async function handleAskFromJobButton(interaction: ButtonInteraction, jobId: string) {
  const config = loadBotConfig();
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

export async function handleImplementFromJobButton(interaction: ButtonInteraction, jobId: string) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

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

  implementSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildImplementModal(config.botName, repoKeys, baseBranch, jobId);
  await interaction.showModal(modal);
}

export async function handleWorktreeCommandsButton(
  interaction: ButtonInteraction,
  jobId: string,
) {
  const config = loadBotConfig();
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
    ? await findLatestJobByChannelThreadAndTypes('discord', channelId, threadId, ['IMPLEMENT']).catch(
        (err) => {
          logger.warn({ err, jobId }, 'Failed to resolve latest implement job');
          return undefined;
        },
      )
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

export async function handleClearJobButton(interaction: ButtonInteraction, jobId: string) {
  await interaction.reply({
    content: `Clear job data for ${jobId}?`,
    components: buildDiscordClearJobConfirmComponents(jobId),
    ephemeral: true,
  });
}

export async function handleClearJobConfirmButton(
  interaction: ButtonInteraction,
  jobId: string,
  workerEventQueue: Queue<WorkerEvent>,
) {
  try {
    await enqueueWorkerEvent(workerEventQueue, {
      type: 'clearJob',
      payload: {
        jobId,
        ttlMs: 5 * 60_000,
      },
    });
    await interaction.update({
      content: `Job ${jobId} will be cleared in 5 minutes.`,
      components: [],
    });
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to schedule job deletion');
    await interaction.update({
      content: `Failed to schedule deletion for job ${jobId}.`,
      components: [],
    });
  }
}

export async function handleClearJobCancelButton(
  interaction: ButtonInteraction,
  jobId: string,
) {
  await interaction.update({
    content: `Job ${jobId} clear cancelled.`,
    components: [],
  });
}
