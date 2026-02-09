import type { SlackHandlerContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { buildImplementModal } from '../../modals.js';

export function registerImplementCommand({ app, slackIds, config }: SlackHandlerContext) {
  app.command(slackIds.commands.implement, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:implement`;
    if (dedupe(dedupeKey)) {
      return;
    }

    await refreshRepoAllowlist(config);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildImplementModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.implementSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadId: (body.thread_ts as string) ?? undefined,
        }),
      ),
    });
  });
}
