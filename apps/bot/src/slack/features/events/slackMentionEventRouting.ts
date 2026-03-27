import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { dedupe } from '../../lib/dedupe.js';
import { createJobId } from '../../../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { fetchSlackThreadContext, stripSlackMentions } from '../../lib/threadContext.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

type SlackMentionEventJobInput = {
  channelId?: string;
  text?: string;
  threadId?: string;
  eventTs?: string;
  userId?: string;
  workspaceId?: string;
  dedupeMode: 'mention' | 'dm-mention';
  onDenyText: string;
};

export async function queueSlackMentionJob(
  {
    app,
    config,
    queue,
    permissions,
    slackIds,
  }: Pick<SlackHandlerContext, 'app' | 'config' | 'queue' | 'permissions' | 'slackIds'>,
  client: SlackHandlerContext['app']['client'],
  input: SlackMentionEventJobInput,
): Promise<boolean> {
  const { channelId, eventTs, text = '', threadId, userId, workspaceId, dedupeMode, onDenyText } =
    input;

  if (!channelId || !threadId || !userId) {
    return false;
  }

  const dedupeKey = `${channelId}:${eventTs ?? threadId}:${dedupeMode}`;
  if (dedupe(dedupeKey)) {
    return false;
  }

  const threadContext = await fetchSlackThreadContext(client, channelId, threadId, eventTs);
  const strippedText = stripSlackMentions(text);
  const requestText =
    strippedText ||
    (threadContext ? 'Please answer based on the thread history.' : '') ||
    'Say hello and ask how you can help.';

  await refreshRepoAllowlist(config);
  const repoKeys = Object.keys(config.repoAllowlist);
  const gitRef = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const job: JobSpec = {
    jobId: createJobId('mention'),
    type: 'MENTION',
    repoKeys,
    gitRef,
    requestText,
    agent: config.primaryAgent,
    channel: {
      provider: 'slack',
      channelId,
      userId,
      ...(threadId ? { threadId } : {}),
    },
    ...(threadContext ? { threadContext } : {}),
  };

  const authorized = await authorizeSlackOperationAndRespond({
    permissions,
    client,
    slackIds,
    action: 'jobs.mention',
    summary: `Queue mention job ${job.jobId}`,
    operation: {
      kind: 'enqueueJob',
      job,
    },
    actor: {
      userId,
      channelId,
      ...(threadId ? { threadId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    },
    onDeny: async () => {
      await postMessage(app, {
        channel: channelId,
        text: onDenyText,
        threadTs: threadId,
      });
    },
    approvalPresentation: 'approval_only',
  });
  if (!authorized) {
    return false;
  }

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist mention job');
    await postMessage(app, {
      channel: channelId,
      text: `I couldn't start that request. Please try again.`,
      threadTs: threadId,
    });
    return false;
  }

  await enqueueJob(queue, job);
  return true;
}
