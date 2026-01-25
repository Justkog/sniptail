import { enqueueJob } from '@sniptail/core/queue/index.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { SlackAppContext } from '../context.js';
import { addReaction, postMessage } from '../../helpers.js';
import { dedupe } from '../../lib/dedupe.js';
import { createJobId } from '../../lib/jobs.js';
import { fetchSlackThreadContext, stripSlackMentions } from '../../lib/threadContext.js';

export function registerAppMentionEvent({ app, config, queue }: SlackAppContext) {
  app.event('app_mention', async ({ event, client }) => {
    const channelId = (event as { channel?: string }).channel;
    const text = (event as { text?: string }).text ?? '';
    const threadTs =
      (event as { thread_ts?: string; ts?: string }).thread_ts ?? (event as { ts?: string }).ts;
    const eventTs = (event as { ts?: string }).ts;
    const botId = (event as { bot_id?: string }).bot_id;
    const userId = (event as { user?: string }).user;

    logger.info({ channelId, threadTs, botId, text }, 'Received app_mention event');

    if (!channelId || !threadTs || botId) {
      return;
    }

    const dedupeKey = `${channelId}:${eventTs ?? threadTs}:mention`;
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

    const slackThreadContext = threadTs
      ? await fetchSlackThreadContext(client, channelId, threadTs, eventTs)
      : undefined;
    const strippedText = stripSlackMentions(text);
    const requestText =
      strippedText ||
      (slackThreadContext ? 'Please answer based on the Slack thread history.' : '') ||
      'Say hello and ask how you can help.';
    const job: JobSpec = {
      jobId: createJobId('mention'),
      type: 'MENTION',
      repoKeys: [],
      gitRef: 'main',
      requestText,
      slack: {
        channelId,
        userId: userId ?? 'unknown',
        ...(threadTs ? { threadTs } : {}),
      },
      ...(slackThreadContext ? { slackThreadContext } : {}),
    };

    try {
      await saveJobQueued(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist mention job');
      await postMessage(app, {
        channel: channelId,
        text: `I couldn't start that request. Please try again.`,
        threadTs,
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
