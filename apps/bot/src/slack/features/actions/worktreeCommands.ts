import {
  findLatestJobBySlackThreadAndTypes,
  loadJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { SlackAppContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { buildWorktreeCommandsText } from '../../lib/worktree.js';

export function registerWorktreeCommandsAction({ app, slackIds, config }: SlackAppContext) {
  app.action(slackIds.actions.worktreeCommands, async ({ ack, body, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;

    if (!jobId || !channelId) {
      return;
    }

    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record');
      return undefined;
    });

    if (!record?.job?.repoKeys?.length) {
      await postMessage(app, {
        channel: channelId,
        text: `Unable to build worktree commands for job ${jobId}.`,
        ...(threadTs ? { threadTs } : {}),
      });
      return;
    }

    const resolvedThreadTs = threadTs ?? record.job.slack.threadTs;
    const latestImplement = resolvedThreadTs
      ? await findLatestJobBySlackThreadAndTypes(channelId, resolvedThreadTs, ['IMPLEMENT']).catch(
          (err) => {
            logger.warn({ err, jobId }, 'Failed to resolve latest implement job');
            return undefined;
          },
        )
      : undefined;
    const targetRepoKeys =
      latestImplement?.job?.repoKeys?.length && latestImplement.job.repoKeys.length
        ? latestImplement.job.repoKeys
        : record.job.repoKeys;
    const messageText = latestImplement
      ? buildWorktreeCommandsText(config, {
          mode: 'branch',
          jobId: latestImplement.job.jobId,
          repoKeys: targetRepoKeys,
          ...(latestImplement.branchByRepo
            ? { branchByRepo: latestImplement.branchByRepo }
            : {}),
        })
      : buildWorktreeCommandsText(config, {
          mode: 'base',
          jobId: record.job.jobId,
          repoKeys: record.job.repoKeys,
          baseRef: record.job.gitRef,
        });
    const messageJobId = latestImplement?.job?.jobId ?? record.job.jobId;
    await postMessage(app, {
      channel: channelId,
      text: `Worktree commands for job ${messageJobId}.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: messageText,
          },
        },
      ],
      ...(threadTs ? { threadTs } : {}),
    });
  });
}
