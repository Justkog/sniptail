import type { SlackHandlerContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { resolveBootstrapServices } from '../../lib/bootstrap.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { buildRepoBootstrapModal } from '../../modals.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerBootstrapCommand({
  app,
  slackIds,
  config,
  permissions,
}: SlackHandlerContext) {
  app.command(slackIds.commands.bootstrap, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:bootstrap`;
    if (dedupe(dedupeKey)) {
      return;
    }

    const authorized = await authorizeSlackPrecheckAndRespond({
      permissions,
      client,
      action: 'jobs.bootstrap',
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
          text: 'You are not authorized to bootstrap repositories.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    const services = resolveBootstrapServices(config);
    if (!services.length) {
      if (body.channel_id && body.user_id) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: 'Repository bootstrap is not configured. Enable bootstrap_services and configure at least one provider.',
        });
      }
      return;
    }

    await refreshRepoAllowlist(config);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildRepoBootstrapModal(
        services,
        config.botName,
        slackIds.actions.bootstrapSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
        }),
        process.env.LOCAL_REPO_ROOT?.trim(),
      ),
    });
  });
}
