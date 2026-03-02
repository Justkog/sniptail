import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { SlackHandlerContext } from '../context.js';
import { addReaction, postMessage } from '../../helpers.js';
import { dedupe } from '../../lib/dedupe.js';
import { createJobId } from '../../../lib/jobs.js';
import { fetchSlackThreadContext, stripSlackMentions } from '../../lib/threadContext.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerAppMentionEvent({
  app,
  config,
  queue,
  permissions,
  slackIds,
}: SlackHandlerContext) {
  app.event('app_mention', async ({ event, client }) => {
    const channelId = (event as { channel?: string }).channel;
    const text = (event as { text?: string }).text ?? '';
    const threadId =
      (event as { thread_ts?: string; ts?: string }).thread_ts ?? (event as { ts?: string }).ts;
    const eventTs = (event as { ts?: string }).ts;
    const botId = (event as { bot_id?: string }).bot_id;
    const userId = (event as { user?: string }).user;

    logger.info({ channelId, threadId, botId, text }, 'Received app_mention event');

    if (!channelId || !threadId || botId) {
      return;
    }

    const dedupeKey = `${channelId}:${eventTs ?? threadId}:mention`;
    if (dedupe(dedupeKey)) {
      return;
    }

    if (channelId && eventTs) {
      await addReaction(app, {
        channel: channelId,
        name: 'eyes',
        timestamp: eventTs,
      });
    }

    const threadContext = threadId
      ? await fetchSlackThreadContext(client, channelId, threadId, eventTs)
      : undefined;
    const strippedText = stripSlackMentions(text);
    const requestText =
      strippedText ||
      (threadContext ? 'Please answer based on the thread history.' : '') ||
      'Say hello and ask how you can help.';
    await refreshRepoAllowlist(config);
    const repoKeys = Object.keys(config.repoAllowlist);
    const job: JobSpec = {
      jobId: createJobId('mention'),
      type: 'MENTION',
      repoKeys,
      gitRef: 'main',
      requestText,
      agent: config.primaryAgent,
      channel: {
        provider: 'slack',
        channelId,
        userId: userId ?? 'unknown',
        ...(threadId ? { threadId } : {}),
      },
      ...(threadContext ? { threadContext } : {}),
    };

    if (!userId) {
      return;
    }
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
        ...((event as { team?: string }).team
          ? { workspaceId: (event as { team?: string }).team }
          : {}),
      },
      onDeny: async () => {
        await postMessage(app, {
          channel: channelId,
          text: 'You are not authorized to mention this bot for jobs.',
          threadTs: threadId,
        });
      },
      approvalPresentation: 'approval_only',
    });
    if (!authorized) {
      return;
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
      return;
    }

    await enqueueJob(queue, job);

    // await postMessage(app, {
    //   channel: channelId,
    //   text: `Got it! I'm working on that now.`,
    //   threadTs,
    // });
  });
}
