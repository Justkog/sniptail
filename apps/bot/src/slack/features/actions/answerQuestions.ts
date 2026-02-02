import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { buildAnswerQuestionsModal } from '../../modals.js';

export function registerAnswerQuestionsAction({ app, slackIds, config }: SlackHandlerContext) {
  app.action(slackIds.actions.answerQuestions, async ({ ack, body, action, client }) => {
    await ack();

    const jobId = (action as { value?: string }).value?.trim();
    if (!jobId) return;

    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record for answer questions');
      return undefined;
    });

    const openQuestions = record?.openQuestions ?? [];
    if (!openQuestions.length) {
      await postMessage(app, {
        channel: body.user.id,
        text: `No open questions were recorded for job ${jobId}.`,
      });
      return;
    }

    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;

    if (!triggerId) {
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: buildAnswerQuestionsModal(
        config.botName,
        slackIds.actions.answerQuestionsSubmit,
        JSON.stringify({
          jobId,
          channelId,
          userId: body.user.id,
          ...(threadId ? { threadId } : {}),
        }),
        openQuestions,
      ),
    });
  });
}
