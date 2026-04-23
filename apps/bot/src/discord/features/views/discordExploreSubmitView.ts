import type { ModalSubmitInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { deleteDiscordSelectionReply, exploreSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { loadDiscordContextFiles } from '../../lib/discordContextFiles.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { submitNormalizedJobRequest } from '../../../job-requests/engine.js';
import { disableDiscordSelectionReply, getActiveDiscordSelection } from '../../state.js';

export async function handleDiscordExploreModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: QueuePublisher<JobSpec>,
  permissions: PermissionsRuntimeService,
) {
  await refreshRepoAllowlist(config);

  const { selection, expiredSelection } = getActiveDiscordSelection(
    exploreSelectionByUser,
    interaction.user.id,
  );
  if (expiredSelection) {
    await disableDiscordSelectionReply(
      interaction,
      expiredSelection,
      'Repository selection expired. Please rerun the explore command.',
      'explore',
    );
    await interaction.reply({
      content: 'Repository selection expired. Please run the explore command again.',
      ephemeral: true,
    });
    return;
  }

  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the explore command again.',
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

  await interaction.deferReply({ ephemeral: true });

  let contextFiles;
  try {
    const uploadedFiles = await loadDiscordContextFiles(selection?.contextAttachments ?? []);
    contextFiles = uploadedFiles.length ? uploadedFiles : undefined;
  } catch (err) {
    logger.warn({ err }, 'Failed to load Discord command context files for explore job');
    await interaction.editReply(`I couldn't use the attached files: ${(err as Error).message}`);
    return;
  }

  const gitRef = interaction.fields.getTextInputValue('git_ref').trim();
  const requestText = interaction.fields.getTextInputValue('question').trim();
  const resumeFromInput = interaction.fields.getTextInputValue('resume_from').trim();
  const resumeFromJobId = resumeFromInput || undefined;
  const threadContext = await fetchDiscordThreadContext(
    interaction.client,
    interaction.channelId!,
    undefined,
    true,
  );

  const result = await submitNormalizedJobRequest({
    config,
    queue,
    input: {
      type: 'EXPLORE',
      repoKeys,
      ...(gitRef ? { gitRef } : {}),
      requestText,
      channel: buildInteractionChannelContext(interaction),
      ...(contextFiles ? { contextFiles } : {}),
      ...(threadContext ? { threadContext } : {}),
      ...(resumeFromJobId ? { resumeFromJobId } : {}),
    },
    authorize: async (job) =>
      authorizeDiscordOperationAndRespond({
        permissions,
        botName: config.botName,
        action: 'jobs.explore',
        summary: `Queue explore job ${job.jobId}`,
        operation: {
          kind: 'enqueueJob',
          job,
        },
        actor: {
          userId: interaction.user.id,
          channelId: job.channel.channelId,
          ...(job.channel.threadId ? { threadId: job.channel.threadId } : {}),
          ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
          member: interaction.member,
        },
        client: interaction.client,
        onDeny: async () => {
          await interaction.editReply('You are not authorized to run explore jobs.');
        },
        onRequireApprovalNotice: async (message) => {
          await interaction.editReply(message);
        },
      }),
  });

  if (result.status === 'invalid') {
    await interaction.editReply(result.message);
    return;
  }

  if (result.status === 'stopped') {
    return;
  }

  if (result.status === 'persist_failed') {
    logger.error({ err: result.error, jobId: result.job.jobId }, 'Failed to persist job');
    await interaction.editReply(`I couldn't persist job ${result.job.jobId}. Please try again.`);
    return;
  }

  const job = result.job;
  const acceptance = await postDiscordJobAcceptance(interaction, job, requestText, config.botName, {
    requestAsPrimaryMessage: true,
  });
  exploreSelectionByUser.delete(interaction.user.id);
  if (acceptance.acceptancePosted) {
    try {
      await interaction.deleteReply();
      await deleteDiscordSelectionReply(interaction, selection, 'explore');
    } catch (err) {
      logger.warn(
        { err, jobId: job.jobId },
        'Failed to delete interaction reply after posting acceptance',
      );
    }
    return;
  }
  await interaction.editReply(`Thanks! I've accepted job ${job.jobId}.`);
}
