import type { ModalSubmitInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { deleteDiscordSelectionReply, runSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';
import { buildRunParamsContinueButton } from '../../modals.js';
import {
  collectRunStepParams,
  normalizeCollectedRunParams,
  resolveRunSelectionSchema,
  toRunParamPayload,
} from '../../lib/runStepper.js';
import { submitNormalizedJobRequest } from '../../../job-requests/engine.js';

export async function handleRunModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: QueuePublisher<JobSpec>,
  permissions: PermissionsRuntimeService,
) {
  await refreshRepoAllowlist(config);

  const selection = runSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Run selection expired. Please run the command again.',
      ephemeral: true,
    });
    return;
  }

  let actionId: string;
  try {
    actionId = normalizeRunActionId(selection?.actionId ?? '');
  } catch {
    await interaction.reply({
      content: 'Run action selection expired. Please run the command again.',
      ephemeral: true,
    });
    return;
  }

  const availableActions = computeAvailableRunActions(config, repoKeys);
  if (!availableActions.some((action) => action.id === actionId)) {
    await interaction.reply({
      content: 'Selected action is no longer available for these repositories.',
      ephemeral: true,
    });
    return;
  }

  const stepIndex = selection?.runStepIndex ?? 0;
  const collectedParams = {
    ...(selection?.collectedParams ?? {}),
  };

  await interaction.deferReply({ ephemeral: true });

  const metadata = resolveRunSelectionSchema(config, {
    repoKeys,
    actionId,
  });
  const stepCount = metadata.steps.length;
  const step = stepCount > 0 ? metadata.steps[stepIndex] : undefined;
  const stepDefinitions = step
    ? metadata.parameters.filter((parameter) => step.fields.includes(parameter.id))
    : [];

  const gitRefInput =
    stepIndex === 0
      ? interaction.fields.getTextInputValue('git_ref').trim()
      : (selection?.gitRef ?? '').trim();
  const gitRef = gitRefInput || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);

  const stepValues = collectRunStepParams(interaction.fields, stepDefinitions);
  Object.assign(collectedParams, stepValues);

  if (step && stepIndex + 1 < stepCount) {
    const nextSelection = {
      repoKeys,
      actionId,
      requestedAt: Date.now(),
      runStepIndex: stepIndex + 1,
      collectedParams,
      gitRef,
      ...(selection?.selectorMessageId ? { selectorMessageId: selection.selectorMessageId } : {}),
    };
    runSelectionByUser.set(interaction.user.id, nextSelection);

    const continueUi = buildRunParamsContinueButton(config.botName, actionId);
    await interaction.editReply({
      content: continueUi.content,
      components: continueUi.components,
    });
    return;
  }

  const normalized = normalizeCollectedRunParams(metadata, collectedParams);

  const requestText = `Run action ${actionId}`;
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
      type: 'RUN',
      repoKeys,
      ...(gitRef ? { gitRef } : {}),
      requestText,
      channel: buildInteractionChannelContext(interaction),
      ...(threadContext ? { threadContext } : {}),
      run: {
        actionId,
        params: toRunParamPayload(normalized.normalized),
      },
    },
    authorize: async (job) =>
      authorizeDiscordOperationAndRespond({
        permissions,
        botName: config.botName,
        action: 'jobs.run',
        summary: `Queue run job ${job.jobId}`,
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
          await interaction.editReply('You are not authorized to run custom actions.');
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
    logger.error({ err: result.error, jobId: result.job.jobId }, 'Failed to persist run job');
    await interaction.editReply(`I couldn't persist job ${result.job.jobId}. Please try again.`);
    return;
  }

  const job = result.job;
  const acceptance = await postDiscordJobAcceptance(interaction, job, requestText, config.botName, {
    acceptanceMessage: `Thanks! I've accepted run job ${job.jobId} (action: ${actionId}). I'll report back here.`,
  });
  runSelectionByUser.delete(interaction.user.id);
  if (acceptance.acceptancePosted) {
    try {
      await interaction.deleteReply();
      await deleteDiscordSelectionReply(interaction, selection, 'run');
    } catch (err) {
      logger.warn(
        { err, jobId: job.jobId, userId: interaction.user.id },
        'Failed to delete interaction reply after accepting run job',
      );
    }
    return;
  }
  await interaction.editReply(`Thanks! I've accepted run job ${job.jobId} (action: ${actionId}).`);
}
