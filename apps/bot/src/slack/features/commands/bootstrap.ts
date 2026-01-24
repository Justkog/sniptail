import type { SlackAppContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { resolveBootstrapServices } from '../../lib/bootstrap.js';
import { refreshRepoAllowlist } from '../../lib/repoAllowlist.js';
import { buildRepoBootstrapModal } from '../../modals.js';

export function registerBootstrapCommand({ app, slackIds, config }: SlackAppContext) {
  app.command(slackIds.commands.bootstrap, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:bootstrap`;
    if (dedupe(dedupeKey)) {
      return;
    }

    const services = resolveBootstrapServices(config);
    if (!services.length) {
      if (body.channel_id && body.user_id) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: 'Repository bootstrap is not configured. Set GITHUB_TOKEN or GITLAB_BASE_URL + GITLAB_TOKEN.',
        });
      }
      return;
    }

    refreshRepoAllowlist(config);
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
