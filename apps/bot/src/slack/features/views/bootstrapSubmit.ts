import { parseRepoAllowlist } from '@sniptail/core/config/index.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueBootstrap } from '@sniptail/core/queue/index.js';
import type { BootstrapRequest, RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';
import type { SlackAppContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { createJobId } from '../../lib/jobs.js';
import { parseOptionalInt } from '../../lib/parsing.js';

export function registerBootstrapSubmitView({ app, slackIds, bootstrapQueue }: SlackAppContext) {
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
    const allowlistPath = process.env.REPO_ALLOWLIST_PATH?.trim();

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
    if (!allowlistPath) {
      errors.repo_name = 'REPO_ALLOWLIST_PATH is not set.';
    }
    if (service === 'local' && !localPathInput) {
      errors.local_path = 'Local directory path is required.';
    }

    let allowlist: Record<string, RepoConfig> | null = null;
    if (allowlistPath && !Object.keys(errors).length) {
      try {
        allowlist = parseRepoAllowlist(allowlistPath);
        if (allowlist[repoKey]) {
          errors.repo_key = `Allowlist key "${repoKey}" already exists.`;
        }
      } catch (err) {
        logger.warn({ err, allowlistPath }, 'Failed to read repo allowlist');
        errors.repo_name = 'Unable to read REPO_ALLOWLIST_PATH. Check JSON formatting.';
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
      if (!allowlistPath || !allowlist || !service) {
        throw new Error('Missing allowlist or service selection.');
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
        slack: {
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
