import type { SlackHandlerContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { buildExploreModal } from '../../modals.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerSlackExploreCommand({
  app,
  slackIds,
  config,
  permissions,
}: SlackHandlerContext) {
  app.command(slackIds.commands.explore, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:explore`;
    if (dedupe(dedupeKey)) {
      return;
    }

    const authorized = await authorizeSlackPrecheckAndRespond({
      permissions,
      client,
      action: 'jobs.explore',
      actor: {
        userId: body.user_id,
        channelId: body.channel_id,
        ...(body.thread_ts ? { threadId: body.thread_ts as string } : {}),
        workspaceId: body.team_id,
      },
      onDeny: async () => {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: 'You are not authorized to run explore jobs.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    await refreshRepoAllowlist(config);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildExploreModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.exploreSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadId: (body.thread_ts as string) ?? undefined,
        }),
      ),
    });
  });
}
