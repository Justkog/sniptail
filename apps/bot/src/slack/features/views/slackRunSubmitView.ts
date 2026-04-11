import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { saveJobQueued, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { rm } from 'node:fs/promises';
import type { SlackHandlerContext } from '../context.js';
import { postMessage, uploadFile } from '../../helpers.js';
import { createJobId, persistUploadSpec } from '../../../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { fetchSlackThreadContext } from '../../lib/threadContext.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';
import {
  normalizeCollectedRunParams,
  resolveRunActionMetadata,
  resolveRunStep,
} from '../../../lib/runActionParams.js';
import { buildRunModal } from '../../modals.js';

type SlackRunViewMetadata = {
  channelId: string;
  userId: string;
  threadId?: string;
  repoKeys?: string[];
  actionId?: string;
  gitRef?: string;
  runStepIndex?: number;
  collectedParams?: Record<string, unknown>;
};

type SlackRunStateValue = {
  value?: string;
  selected_option?: { value?: string };
  selected_options?: Array<{ value?: string }>;
};

function parseRunViewMetadata(value?: string): SlackRunViewMetadata | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as SlackRunViewMetadata;
    if (!parsed?.channelId || !parsed?.userId) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function parseRunParamInput(
  raw: string,
  type: 'string' | 'number' | 'boolean' | 'string[]',
): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (type === 'string[]') {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (type === 'number' || type === 'boolean') {
    return trimmed;
  }
  return raw;
}

function parseRunStepParams(
  state: Record<string, Record<string, SlackRunStateValue>>,
  parameterIds: Array<{ id: string; type: 'string' | 'number' | 'boolean' | 'string[]' }>,
) {
  const values: Record<string, unknown> = {};
  for (const parameter of parameterIds) {
    const blockId = `run_param_${parameter.id}`;
    const actionId = `run_param_${parameter.id}`;
    const raw = state[blockId]?.[actionId]?.value ?? '';
    const parsed = parseRunParamInput(raw, parameter.type);
    if (parsed !== undefined) {
      values[parameter.id] = parsed;
    }
  }
  return values;
}

export function registerRunSubmitView({
  app,
  slackIds,
  config,
  queue,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.runSubmit, async ({ ack, body, view, client }) => {
    const state = view.state.values as Record<string, Record<string, SlackRunStateValue>>;
    const metadata = parseRunViewMetadata(view.private_metadata);
    const selectedRepoKeys =
      state.repos?.repo_keys?.selected_options
        ?.map((opt) => opt.value)
        .filter((value): value is string => Boolean(value)) ?? [];
    const repoKeys = metadata?.repoKeys ?? selectedRepoKeys;
    const gitRef =
      metadata?.gitRef?.trim() ||
      state.branch?.git_ref?.value?.trim() ||
      resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const actionIdRaw =
      metadata?.actionId ??
      state.run_action?.[slackIds.actions.runActionSelect]?.selected_option?.value?.trim() ??
      '';
    const runStepIndex = metadata?.runStepIndex;
    const hasRunActionInput = Boolean(state.run_action?.[slackIds.actions.runActionSelect]);
    const collectedParams = {
      ...(metadata?.collectedParams ?? {}),
    };

    if (!repoKeys.length) {
      await ack();
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `Please select at least one repo for ${slackIds.commands.run}.`,
      });
      return;
    }

    if (!hasRunActionInput && runStepIndex === undefined && !metadata?.actionId) {
      const actionSelectMetadata: SlackRunViewMetadata = {
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
        repoKeys,
        gitRef,
        collectedParams,
      };

      await ack({
        response_action: 'update',
        view: buildRunModal(
          config.repoAllowlist,
          config.botName,
          slackIds.actions.runSubmit,
          JSON.stringify(actionSelectMetadata),
          slackIds.actions.runActionSelect,
          repoKeys,
          {
            includeRepoSelection: false,
            includeActionSelection: true,
            includeGitRef: false,
            submitLabel: 'Continue',
          },
        ),
      });
      return;
    }

    let actionId: string;
    try {
      actionId = normalizeRunActionId(actionIdRaw);
    } catch {
      await ack();
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: 'Please choose a valid run action.',
      });
      return;
    }

    const availableActions = computeAvailableRunActions(config, repoKeys);
    if (!availableActions.some((action) => action.id === actionId)) {
      await ack();
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: 'That run action is not available for the selected repositories.',
      });
      return;
    }

    const actionMetadata = resolveRunActionMetadata(config, repoKeys, actionId);

    // Parameter entry starts on an updated step modal after action selection (replacing the action selection view).
    if (runStepIndex === undefined && actionMetadata.steps.length > 0) {
      const firstStep = resolveRunStep(actionMetadata, 0);
      if (!firstStep) {
        await ack();
        await postMessage(app, {
          channel: metadata?.channelId ?? body.user.id,
          text: 'Run parameter flow expired. Please start the run command again.',
        });
        return;
      }

      const firstStepMetadata: SlackRunViewMetadata = {
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
        repoKeys,
        actionId,
        gitRef,
        runStepIndex: 0,
        collectedParams,
      };

      await ack({
        response_action: 'update',
        view: buildRunModal(
          config.repoAllowlist,
          config.botName,
          slackIds.actions.runSubmit,
          JSON.stringify(firstStepMetadata),
          slackIds.actions.runActionSelect,
          repoKeys,
          {
            includeRepoSelection: false,
            includeActionSelection: false,
            includeGitRef: false,
            parameters: firstStep.parameters,
            initialParams: collectedParams,
            stepTitle: `Run 1/${actionMetadata.steps.length}`,
            submitLabel: actionMetadata.steps.length > 1 ? 'Continue' : 'Run',
          },
        ),
      });
      return;
    }

    const currentStep =
      runStepIndex === undefined ? undefined : resolveRunStep(actionMetadata, runStepIndex);
    if (runStepIndex !== undefined && actionMetadata.steps.length > 0 && !currentStep) {
      await ack();
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: 'Run parameter flow expired. Please start the run command again.',
      });
      return;
    }

    if (currentStep) {
      Object.assign(
        collectedParams,
        parseRunStepParams(
          state,
          currentStep.parameters.map((parameter) => ({
            id: parameter.id,
            type: parameter.type,
          })),
        ),
      );
    }

    const nextStepIndex = (runStepIndex ?? 0) + 1;
    if (runStepIndex !== undefined && nextStepIndex < actionMetadata.steps.length) {
      const nextStep = resolveRunStep(actionMetadata, nextStepIndex);
      if (!nextStep) {
        await ack();
        await postMessage(app, {
          channel: metadata?.channelId ?? body.user.id,
          text: 'Run parameter flow expired. Please start the run command again.',
        });
        return;
      }

      const nextMetadata: SlackRunViewMetadata = {
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
        repoKeys,
        actionId,
        gitRef,
        runStepIndex: nextStepIndex,
        collectedParams,
      };

      await ack({
        response_action: 'push',
        view: buildRunModal(
          config.repoAllowlist,
          config.botName,
          slackIds.actions.runSubmit,
          JSON.stringify(nextMetadata),
          slackIds.actions.runActionSelect,
          repoKeys,
          {
            includeRepoSelection: false,
            includeActionSelection: false,
            includeGitRef: false,
            parameters: nextStep.parameters,
            initialParams: collectedParams,
            stepTitle: `Run ${nextStepIndex + 1}/${actionMetadata.steps.length}`,
            submitLabel: nextStepIndex + 1 < actionMetadata.steps.length ? 'Continue' : 'Run',
          },
        ),
      });
      return;
    }

    const normalizedParams = normalizeCollectedRunParams(actionMetadata, collectedParams);

    await ack({ response_action: 'clear' });

    const threadContext =
      metadata?.threadId && metadata?.channelId
        ? await fetchSlackThreadContext(client, metadata.channelId, metadata.threadId)
        : undefined;

    const job: JobSpec = {
      jobId: createJobId('run'),
      type: 'RUN',
      repoKeys,
      primaryRepoKey: repoKeys[0]!,
      gitRef,
      requestText: `Run action ${actionId}`,
      run: {
        actionId,
        params: normalizedParams.normalized,
      },
      agent: config.primaryAgent,
      channel: {
        provider: 'slack',
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
      },
      ...(threadContext ? { threadContext } : {}),
    };

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client: app.client,
      slackIds,
      action: 'jobs.run',
      summary: `Queue run job ${job.jobId}`,
      operation: {
        kind: 'enqueueJob',
        job,
      },
      actor: {
        userId: job.channel.userId ?? body.user.id,
        channelId: job.channel.channelId,
        ...(job.channel.threadId ? { threadId: job.channel.threadId } : {}),
      },
      onDeny: async () => {
        await postMessage(app, {
          channel: metadata?.channelId ?? body.user.id,
          text: 'You are not authorized to run custom actions.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    try {
      await saveJobQueued(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist run job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't persist job ${job.jobId}. Please try again.`,
      });
      return;
    }

    await enqueueJob(queue, job);

    const ackResponse = await postMessage(app, {
      channel: metadata?.channelId ?? body.user.id,
      text: `Thanks! I've accepted run job ${job.jobId} (action: ${actionId}). I'll report back here.`,
      ...(metadata?.threadId ? { threadTs: metadata.threadId } : {}),
    });

    const ackThreadId = metadata?.threadId ?? ackResponse?.ts;
    if (config.debugJobSpecMessages) {
      const botNamePrefix = toSlackCommandPrefix(config.botName);
      const uploadSpecPath = await persistUploadSpec(job);
      if (!uploadSpecPath) {
        logger.warn({ jobId: job.jobId }, 'Skipping job spec upload without sanitized artifact');
      } else {
        const jobSpecOptions = {
          channel: metadata?.channelId ?? body.user.id,
          filePath: uploadSpecPath,
          title: `${botNamePrefix}-${job.jobId}-job-spec.json`,
        };
        try {
          await uploadFile(
            app,
            ackThreadId ? { ...jobSpecOptions, threadTs: ackThreadId } : jobSpecOptions,
          );
        } catch (err) {
          logger.warn({ err, jobId: job.jobId }, 'Failed to upload job spec artifact');
        } finally {
          await rm(uploadSpecPath, { force: true }).catch((err) => {
            logger.warn({ err, jobId: job.jobId }, 'Failed to remove job spec upload artifact');
          });
        }
      }
    }

    if (!metadata?.threadId && ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          channel: {
            ...job.channel,
            threadId: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job thread timestamp');
      });
    }
  });
}
