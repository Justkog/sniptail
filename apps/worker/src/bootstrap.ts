import type { Queue } from 'bullmq';
import {
  loadWorkerConfig,
  parseRepoAllowlist,
  writeRepoAllowlist,
} from '@sniptail/core/config/index.js';
import {
  bootstrapLocalRepository,
  defaultLocalBaseBranch,
  resolveLocalRepoPath,
} from '@sniptail/core/git/bootstrap.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { createRepository } from '@sniptail/core/github/client.js';
import { createProject } from '@sniptail/core/gitlab/client.js';
import { logger } from '@sniptail/core/logger.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';
import { sendBotEvent } from './botEvents.js';

const config = loadWorkerConfig();

function formatUserMention(userId?: string) {
  return userId ? `<@${userId}> ` : '';
}

function buildRepoDisplay(service: BootstrapRequest['service'], repoLabel: string, repoUrl: string) {
  if (service === 'local') {
    return repoLabel;
  }
  return `<${repoUrl}|${repoLabel}>`;
}

export async function runBootstrap(
  botQueue: Queue<BotEvent>,
  request: BootstrapRequest,
): Promise<void> {
  const responseChannel = request.slack.channelId;
  const userPrefix = formatUserMention(request.slack.userId);

  await sendBotEvent(botQueue, {
    type: 'postMessage',
    payload: {
      channel: responseChannel,
      text: `${userPrefix}Bootstrapping ${request.repoName}...`,
    },
  });

  try {
    const allowlistPath = process.env.REPO_ALLOWLIST_PATH?.trim();
    if (!allowlistPath) {
      throw new Error('REPO_ALLOWLIST_PATH is not set.');
    }

    const allowlist = parseRepoAllowlist(allowlistPath);
    if (allowlist[request.repoKey]) {
      throw new Error(`Allowlist key "${request.repoKey}" already exists.`);
    }

    let allowlistEntry: RepoConfig;
    let repoUrl = '';
    let repoLabel = '';

    if (request.service === 'local') {
      const root = process.env.LOCAL_REPO_ROOT?.trim();
      const resolved = resolveLocalRepoPath(request.localPath ?? '', root);
      await bootstrapLocalRepository({
        repoPath: resolved.path,
        repoName: request.repoName,
        baseBranch: defaultLocalBaseBranch,
        quickstart: request.quickstart,
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
        throw new Error('GitHub is not configured. Set GITHUB_TOKEN.');
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

    await sendBotEvent(botQueue, {
      type: 'postMessage',
      payload: {
        channel: responseChannel,
        text: `${userPrefix}Created ${serviceName} repo ${repoLabel} and added allowlist entry ${request.repoKey}.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${serviceName} repo created*\n• Repo: ${repoDisplay}\n• Allowlist key: \`${request.repoKey}\``,
            },
          },
        ],
      },
    });
  } catch (err) {
    logger.error({ err, requestId: request.requestId }, 'Failed to bootstrap repository');
    await sendBotEvent(botQueue, {
      type: 'postMessage',
      payload: {
        channel: responseChannel,
        text: `${userPrefix}Failed to create repository: ${(err as Error).message}`,
      },
    });
  }
}
