import {
  loadWorkerConfig,
  parseRepoAllowlist,
  writeRepoAllowlist,
} from '@sniptail/core/config/config.js';
import {
  bootstrapLocalRepository,
  defaultLocalBaseBranch,
  resolveLocalRepoPath,
} from '@sniptail/core/git/bootstrap.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { createRepository } from '@sniptail/core/github/client.js';
import { createProject } from '@sniptail/core/gitlab/client.js';
import { logger } from '@sniptail/core/logger.js';
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
    const allowlistPath = config.repoAllowlistPath;
    if (!allowlistPath) {
      throw new Error('Repo allowlist path is not set in config.');
    }

    const allowlist = parseRepoAllowlist(allowlistPath);
    if (allowlist[request.repoKey]) {
      throw new Error(`Allowlist key "${request.repoKey}" already exists.`);
    }

    let allowlistEntry: RepoConfig;
    let repoUrl = '';
    let repoLabel = '';

    if (request.service === 'local') {
      const resolved = resolveLocalRepoPath(request.localPath ?? '', config.localRepoRoot);
      await bootstrapLocalRepository({
        repoPath: resolved.path,
        repoName: request.repoName,
        baseBranch: defaultLocalBaseBranch,
        quickstart: Boolean(request.quickstart),
        env: process.env,
      });
      allowlistEntry = {
        localPath: resolved.path,
        baseBranch: defaultLocalBaseBranch,
      };
      repoUrl = resolved.path;
      repoLabel = resolved.path;
    } else if (request.service === 'github') {
      if (!config.github) {
        throw new Error('GitHub is not configured. Set GITHUB_API_TOKEN.');
      }
      const repo = await createRepository({
        config: config.github,
        name: request.repoName,
        ...(request.owner !== undefined && { owner: request.owner }),
        ...(request.description !== undefined && { description: request.description }),
        ...(request.visibility !== undefined && { private: request.visibility === 'private' }),
        autoInit: Boolean(request.quickstart),
      });
      allowlistEntry = {
        sshUrl: repo.sshUrl,
        ...(repo.defaultBranch ? { baseBranch: repo.defaultBranch } : {}),
      };
      repoUrl = repo.url;
      repoLabel = repo.fullName;
    } else {
      if (!config.gitlab) {
        throw new Error('GitLab is not configured. Set GITLAB_BASE_URL and GITLAB_TOKEN.');
      }
      const project = await createProject({
        config: config.gitlab,
        name: request.repoName,
        path: sanitizeRepoKey(request.repoName),
        ...(request.gitlabNamespaceId !== undefined && { namespaceId: request.gitlabNamespaceId }),
        ...(request.description !== undefined && { description: request.description }),
        ...(request.visibility !== undefined && { visibility: request.visibility }),
        initializeWithReadme: Boolean(request.quickstart),
      });
      allowlistEntry = {
        sshUrl: project.sshUrl,
        projectId: project.id,
        ...(project.defaultBranch ? { baseBranch: project.defaultBranch } : {}),
      };
      repoUrl = project.webUrl;
      repoLabel = project.pathWithNamespace;
    }

    allowlist[request.repoKey] = allowlistEntry;
    await writeRepoAllowlist(allowlistPath, allowlist);
    config.repoAllowlist[request.repoKey] = allowlistEntry;

    const serviceName =
      request.service === 'github' ? 'GitHub' : request.service === 'gitlab' ? 'GitLab' : 'Local';
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
