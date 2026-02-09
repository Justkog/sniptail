import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueBootstrap } from '@sniptail/core/queue/queue.js';
import type { BootstrapRequest, RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { createJobId } from '../../../lib/jobs.js';
import { parseOptionalInt } from '../../lib/parsing.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';

export function registerBootstrapSubmitView({
  app,
  slackIds,
  bootstrapQueue,
  config,
}: SlackHandlerContext) {
  app.view(slackIds.actions.bootstrapSubmit, async ({ ack, body, view, client }) => {
    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as { channelId: string; userId: string })
      : undefined;
    const repoName = state.repo_name?.repo_name?.value?.trim() ?? '';
    const repoKeyInput = state.repo_key?.repo_key?.value?.trim() ?? '';
    const service = state.service?.service?.selected_option?.value as
      | RepoBootstrapService
      | undefined;
    const localPathInput = state.local_path?.local_path?.value?.trim() ?? '';
    const owner = state.owner?.owner?.value?.trim() || undefined;
    const description = state.description?.description?.value?.trim() || undefined;
    const visibility = state.visibility?.visibility?.selected_option?.value as
      | 'private'
      | 'public'
      | undefined;
    const quickstart = Boolean(
      state.quickstart?.quickstart?.selected_options?.some((option) => option.value === 'readme'),
    );
    const namespaceIdRaw = state.gitlab_namespace_id?.gitlab_namespace_id?.value?.trim();
    const namespaceId = parseOptionalInt(namespaceIdRaw);
    const repoKey = sanitizeRepoKey(repoKeyInput || repoName);

    const errors: Record<string, string> = {};
    if (!repoName) {
      errors.repo_name = 'Repository name is required.';
    }
    if (!repoKey) {
      errors.repo_key = 'Allowlist key must include letters or numbers.';
    }
    if (!service) {
      errors.service = 'Choose a repository service.';
    }
    if (namespaceIdRaw && namespaceId === undefined) {
      errors.gitlab_namespace_id = 'Namespace ID must be a number.';
    }
    if (service === 'local' && !localPathInput) {
      errors.local_path = 'Local directory path is required.';
    }

    if (!Object.keys(errors).length) {
      await refreshRepoAllowlist(config);
      if (config.repoAllowlist[repoKey]) {
        errors.repo_key = `Allowlist key "${repoKey}" already exists.`;
      }
    }

    if (Object.keys(errors).length) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    await ack();

    const responseChannel = metadata?.channelId ?? body.user.id;
    const responseUser = metadata?.userId ?? body.user.id;

    try {
      if (!service) {
        throw new Error('Missing service selection.');
      }

      const requestId = createJobId('bootstrap');
      const bootstrapRequest: BootstrapRequest = {
        requestId,
        repoName,
        repoKey,
        service,
        ...(owner ? { owner } : {}),
        ...(description ? { description } : {}),
        ...(visibility ? { visibility } : {}),
        ...(quickstart ? { quickstart } : {}),
        ...(namespaceId !== undefined ? { gitlabNamespaceId: namespaceId } : {}),
        ...(service === 'local' && localPathInput ? { localPath: localPathInput } : {}),
        channel: {
          provider: 'slack',
          channelId: responseChannel,
          userId: responseUser,
        },
      };

      await enqueueBootstrap(bootstrapQueue, bootstrapRequest);

      await postMessage(app, {
        channel: responseChannel,
        text: `Queued bootstrap for ${repoName}. I'll post updates here shortly.`,
      });
    } catch (err) {
      logger.error({ err, repoName, service }, 'Failed to bootstrap repository');
      if (responseChannel && responseUser) {
        await client.chat.postEphemeral({
          channel: responseChannel,
          user: responseUser,
          text: `Failed to create repository: ${(err as Error).message}`,
        });
      } else {
        await postMessage(app, {
          channel: responseChannel,
          text: `Failed to create repository: ${(err as Error).message}`,
        });
      }
    }
  });
}
