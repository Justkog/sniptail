import type { SlackAppContext } from '../context.js';
import { buildAskModal } from '../../modals.js';

export function registerAskFromJobAction({ app, slackIds, config }: SlackAppContext) {
  app.action(slackIds.actions.askFromJob, async ({ ack, body, client, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (!jobId || !triggerId || !channelId || !userId) {
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: buildAskModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.askSubmit,
        JSON.stringify({
          channelId,
          userId,
          threadId: threadId ?? undefined,
        }),
        jobId,
      ),
    });
  });
}
