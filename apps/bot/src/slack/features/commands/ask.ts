import type { SlackHandlerContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { refreshRepoAllowlist } from '../../lib/repoAllowlist.js';
import { buildAskModal } from '../../modals.js';

export function registerAskCommand({ app, slackIds, config }: SlackHandlerContext) {
  app.command(slackIds.commands.ask, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:ask`;
    if (dedupe(dedupeKey)) {
      return;
    }

    refreshRepoAllowlist(config);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildAskModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.askSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadId: (body.thread_ts as string) ?? undefined,
        }),
      ),
    });
  });
}
