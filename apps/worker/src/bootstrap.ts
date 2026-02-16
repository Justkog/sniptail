import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import {
  loadRepoAllowlistFromCatalog,
  syncAllowlistFileFromCatalog,
  upsertRepoCatalogEntry,
} from '@sniptail/core/repos/catalog.js';
import { getRepoProvider, getRepoProviderDisplayName } from '@sniptail/core/repos/providers.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';
import type { BotEventSink } from './channels/botEventSink.js';
import { createNotifier } from './channels/createNotifier.js';

const config = loadWorkerConfig();

function formatUserMention(userId?: string) {
  return userId ? `<@${userId}> ` : '';
}

function buildRepoDisplay(
  service: BootstrapRequest['service'],
  repoLabel: string,
  repoUrl: string,
) {
  if (service === 'local') {
    return repoLabel;
  }
  return `<${repoUrl}|${repoLabel}>`;
}

export async function runBootstrap(events: BotEventSink, request: BootstrapRequest): Promise<void> {
  const responseChannel = request.channel.channelId;
  const userPrefix = formatUserMention(request.channel.userId);
  const notifier = createNotifier(events);
  const channelRef: ChannelRef = {
    provider: request.channel.provider,
    channelId: responseChannel,
    ...(request.channel.threadId ? { threadId: request.channel.threadId } : {}),
  };

  await notifier.postMessage(channelRef, `${userPrefix}Bootstrapping ${request.repoName}...`);

  try {
    const allowlist = await loadRepoAllowlistFromCatalog();
    if (allowlist[request.repoKey]) {
      throw new Error(`Allowlist key "${request.repoKey}" already exists.`);
    }

    let allowlistEntry: RepoConfig;
    let repoUrl = '';
    let repoLabel = '';
    const provider = getRepoProvider(request.service);
    if (!provider) {
      throw new Error(`Unsupported repository service: ${request.service}`);
    }
    if (!provider.createRepository) {
      throw new Error(`${provider.displayName} does not support repository bootstrap.`);
    }
    const created = await provider.createRepository(
      {
        ...(config.github ? { github: config.github } : {}),
        ...(config.gitlab ? { gitlab: config.gitlab } : {}),
      },
      {
        repoName: request.repoName,
        ...(request.owner !== undefined ? { owner: request.owner } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.visibility !== undefined ? { visibility: request.visibility } : {}),
        ...(request.providerData ? { providerData: request.providerData } : {}),
        ...(request.gitlabNamespaceId !== undefined
          ? { providerData: { ...(request.providerData ?? {}), namespaceId: request.gitlabNamespaceId } }
          : {}),
        ...(request.service === 'local' ? { localPath: request.localPath } : {}),
        ...(config.localRepoRoot ? { localRepoRoot: config.localRepoRoot } : {}),
        env: process.env,
      },
    );
    allowlistEntry = created.repoConfig;
    repoUrl = created.repoUrl;
    repoLabel = created.repoLabel;

    await upsertRepoCatalogEntry(request.repoKey, allowlistEntry);
    config.repoAllowlist[request.repoKey] = allowlistEntry;
    if (config.repoAllowlistPath) {
      await syncAllowlistFileFromCatalog(config.repoAllowlistPath).catch((err) => {
        logger.warn(
          { err, allowlistPath: config.repoAllowlistPath },
          'Failed to sync allowlist file from repository catalog',
        );
      });
    }

    const serviceName = getRepoProviderDisplayName(request.service);
    const repoDisplay = buildRepoDisplay(request.service, repoLabel, repoUrl);

    if (request.channel.provider === 'slack') {
      await notifier.postMessage(
        channelRef,
        `${userPrefix}Created ${serviceName} repo ${repoLabel} and added allowlist entry ${request.repoKey}.`,
        {
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${serviceName} repo created*\\n• Repo: ${repoDisplay}\\n• Allowlist key: \`${request.repoKey}\``,
              },
            },
          ],
        },
      );
    } else {
      await notifier.postMessage(
        channelRef,
        `${userPrefix}Created ${serviceName} repo ${repoLabel} and added allowlist entry ${request.repoKey}.`,
      );
    }
  } catch (err) {
    logger.error({ err, requestId: request.requestId }, 'Failed to bootstrap repository');
    await notifier.postMessage(
      channelRef,
      `${userPrefix}Failed to create repository: ${(err as Error).message}`,
    );
  }
}
