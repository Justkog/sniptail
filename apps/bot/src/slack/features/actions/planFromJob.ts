import type { SlackHandlerContext } from '../context.js';
import { buildPlanModal } from '../../modals.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';

export function registerPlanFromJobAction({ app, slackIds, config }: SlackHandlerContext) {
  app.action(slackIds.actions.planFromJob, async ({ ack, body, client, action }) => {
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

    await refreshRepoAllowlist(config);
    await client.views.open({
      trigger_id: triggerId,
      view: buildPlanModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.planSubmit,
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
