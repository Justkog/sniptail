import type { SlackAppContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { refreshRepoAllowlist } from '../../lib/repoAllowlist.js';
import { buildPlanModal } from '../../modals.js';

export function registerPlanCommand({ app, slackIds, config }: SlackAppContext) {
  app.command(slackIds.commands.plan, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:plan`;
    if (dedupe(dedupeKey)) {
      return;
    }

    refreshRepoAllowlist(config);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildPlanModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.planSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadId: (body.thread_ts as string) ?? undefined,
        }),
      ),
    });
  });
}
