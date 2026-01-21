import { App, type CodedError } from '@slack/bolt';
import type { Queue } from 'bullmq';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchCodexUsageMessage } from '@sniptail/core/codex/status.js';
import { loadBotConfig } from '@sniptail/core/config/index.js';
import {
  clearJobsBefore,
  loadJobRecord,
  markJobForDeletion,
  saveJobQueued,
  updateJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/index.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { JobSettings, JobSpec } from '@sniptail/core/types/job.js';
import { addReaction, postMessage, uploadFile } from './helpers.js';
import { buildAskModal, buildImplementModal, resolveDefaultBaseBranch } from './modals.js';

const config = loadBotConfig();

const recentRequests = new Map<string, number>();
const dedupeWindowMs = 2 * 60 * 1000;
const worktreeBranchPrefix = 'sniptail';
const maxThreadHistoryMessages = 20;
const maxThreadHistoryChars = 4000;

function dedupe(key: string): boolean {
  const now = Date.now();
  for (const [storedKey, ts] of recentRequests.entries()) {
    if (now - ts > dedupeWindowMs) {
      recentRequests.delete(storedKey);
    }
  }
  if (recentRequests.has(key)) {
    return true;
  }
  recentRequests.set(key, now);
  return false;
}

function parseCommaList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function parseCutoffDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createJobId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildWorktreeCommandsText(
  jobId: string,
  repoKeys: string[],
  branchByRepo?: Record<string, string>,
) {
  const lines: string[] = [`*Worktree branch commands for job ${jobId}*`];
  for (const repoKey of repoKeys) {
    const branch = branchByRepo?.[repoKey] ?? `${worktreeBranchPrefix}/${jobId}`;
    const repoConfig = config.repoAllowlist[repoKey];
    const cloneUrl = repoConfig?.localPath ?? repoConfig?.sshUrl ?? '<repo-url>';

    lines.push('');
    lines.push(`*${repoKey}*`);
    if (!repoConfig) {
      lines.push(`Repo config not found for ${repoKey}.`);
    }
    lines.push('Already cloned:');
    lines.push('```');
    lines.push(`git fetch origin ${branch}`);
    lines.push(`git checkout --track origin/${branch}`);
    lines.push('```');
    lines.push('Not cloned yet:');
    lines.push('```');
    lines.push(`git clone --single-branch -b ${branch} ${cloneUrl}`);
    lines.push('```');
  }
  return lines.join('\n');
}

async function fetchSlackThreadContext(
  client: App['client'],
  channelId: string,
  threadTs: string,
  excludeTs?: string,
): Promise<string | undefined> {
  try {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
    });
    const messages =
      (
        response as {
          messages?: Array<{
            ts?: string;
            text?: string;
            user?: string;
            bot_id?: string;
            subtype?: string;
          }>;
        }
      ).messages ?? [];
    const filtered = messages
      .filter((message) => message.ts && message.text)
      .filter((message) => message.ts !== excludeTs)
      .filter((message) => message.subtype !== 'bot_message')
      .slice(-maxThreadHistoryMessages);
    const lines = filtered
      .map((message) => {
        const author = message.user ?? message.bot_id ?? 'unknown';
        const text = stripSlackMentions(message.text ?? '').trim();
        if (!text) return null;
        return `${author}: ${text}`;
      })
      .filter((line): line is string => Boolean(line));
    if (!lines.length) return undefined;
    const joined = lines.join('\n');
    if (joined.length <= maxThreadHistoryChars) {
      return joined;
    }
    return `...${joined.slice(-maxThreadHistoryChars)}`;
  } catch (err) {
    logger.warn({ err, channelId, threadTs }, 'Failed to fetch Slack thread history');
    return undefined;
  }
}

async function persistJobSpec(job: JobSpec): Promise<string | null> {
  const jobRoot = join(config.jobWorkRoot, job.jobId);
  const artifactsRoot = join(jobRoot, 'artifacts');
  const jobSpecPath = join(artifactsRoot, 'job-spec.json');
  try {
    await mkdir(artifactsRoot, { recursive: true });
    await writeFile(jobSpecPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
    return jobSpecPath;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec artifact');
    return null;
  }
}

async function persistSlackUploadSpec(job: JobSpec): Promise<string | null> {
  const jobRoot = join(config.jobWorkRoot, job.jobId);
  const artifactsRoot = join(jobRoot, 'artifacts');
  const jobSpecPath = join(artifactsRoot, 'job-spec-upload.json');
  try {
    await mkdir(artifactsRoot, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { requestText: _requestText, slackThreadContext: _slackThreadContext, ...jobSpec } = job;
    await writeFile(jobSpecPath, `${JSON.stringify(jobSpec, null, 2)}\n`, 'utf8');
    return jobSpecPath;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec upload artifact');
    return null;
  }
}

export function createSlackApp(queue: Queue<JobSpec>) {
  const slackIds = buildSlackIds(config.botName);
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  app.command(slackIds.commands.ask, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:ask`;
    if (dedupe(dedupeKey)) {
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildAskModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.askSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadTs: (body.thread_ts as string) ?? undefined,
        }),
      ),
    });
  });

  app.command(slackIds.commands.implement, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:implement`;
    if (dedupe(dedupeKey)) {
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildImplementModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.implementSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadTs: (body.thread_ts as string) ?? undefined,
        }),
      ),
    });
  });

  app.command(slackIds.commands.clearBefore, async ({ ack, body, client }) => {
    const userId = body.user_id;
    if (!userId || !config.adminUserIds.includes(userId)) {
      await ack({
        response_type: 'ephemeral',
        text: 'You are not authorized to clear jobs.',
      });
      return;
    }

    const cutoff = parseCutoffDateInput(body.text ?? '');
    if (!cutoff) {
      await ack({
        response_type: 'ephemeral',
        text: `Usage: ${slackIds.commands.clearBefore} YYYY-MM-DD (or ISO timestamp).`,
      });
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: `Clearing jobs created before ${cutoff.toISOString()}...`,
    });

    try {
      const cleared = await clearJobsBefore(cutoff);
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: `Cleared ${cleared} job(s) created before ${cutoff.toISOString()}.`,
      });
    } catch (err) {
      logger.error({ err, cutoff: cutoff.toISOString() }, 'Failed to clear jobs before cutoff');
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: `Failed to clear jobs before ${cutoff.toISOString()}.`,
      });
    }
  });

  app.command(slackIds.commands.usage, async ({ ack, body, client }) => {
    await ack({
      response_type: 'ephemeral',
      text: 'Checking Codex usage...',
    });

    const userId = body.user_id;
    if (!userId) {
      return;
    }

    try {
      const { message } = await fetchCodexUsageMessage();
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: message,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch Codex usage status');
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: 'Failed to fetch Codex usage status. Please try again shortly.',
      });
    }
  });

  app.action(slackIds.actions.askFromJob, async ({ ack, body, client, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (!jobId || !triggerId || !channelId || !userId) {
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: buildAskModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.askSubmit,
        JSON.stringify({
          channelId,
          userId,
          threadTs: threadTs ?? undefined,
        }),
        jobId,
      ),
    });
  });

  app.action(slackIds.actions.implementFromJob, async ({ ack, body, client, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (!jobId || !triggerId || !channelId || !userId) {
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: buildImplementModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.implementSubmit,
        JSON.stringify({
          channelId,
          userId,
          threadTs: threadTs ?? undefined,
        }),
        jobId,
      ),
    });
  });

  app.action(slackIds.actions.worktreeCommands, async ({ ack, body, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;

    if (!jobId || !channelId) {
      return;
    }

    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record');
      return undefined;
    });

    if (!record?.job?.repoKeys?.length) {
      await postMessage(app, {
        channel: channelId,
        text: `Unable to build worktree commands for job ${jobId}.`,
        ...(threadTs ? { threadTs } : {}),
      });
      return;
    }

    const messageText = buildWorktreeCommandsText(jobId, record.job.repoKeys, record.branchByRepo);
    await postMessage(app, {
      channel: channelId,
      text: `Worktree commands for job ${jobId}.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: messageText,
          },
        },
      ],
      ...(threadTs ? { threadTs } : {}),
    });
  });

  app.action(slackIds.actions.clearJob, async ({ ack, body, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs = (body as { message?: { ts?: string } }).message?.ts;

    if (!jobId) {
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: 'Unable to clear job: missing job id.',
          ...(threadTs ? { threadTs } : {}),
        });
      }
      return;
    }

    try {
      await markJobForDeletion(jobId, 5 * 60_000);
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: `Job ${jobId} will be cleared in 5 minutes.`,
          ...(threadTs ? { threadTs } : {}),
        });
      }
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to schedule job deletion');
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: `Failed to schedule deletion for job ${jobId}.`,
          ...(threadTs ? { threadTs } : {}),
        });
      }
    }
  });

  app.event('app_mention', async ({ event, client }) => {
    const channelId = (event as { channel?: string }).channel;
    const text = (event as { text?: string }).text ?? '';
    const threadTs =
      (event as { thread_ts?: string; ts?: string }).thread_ts ?? (event as { ts?: string }).ts;
    const eventTs = (event as { ts?: string }).ts;
    const botId = (event as { bot_id?: string }).bot_id;
    const userId = (event as { user?: string }).user;

    logger.info({ channelId, threadTs, botId, text }, 'Received app_mention event');

    if (!channelId || !threadTs || botId) {
      return;
    }

    const dedupeKey = `${channelId}:${eventTs ?? threadTs}:mention`;
    if (dedupe(dedupeKey)) {
      return;
    }

    if (channelId && eventTs) {
      await addReaction(app, {
        channel: channelId,
        name: 'eyes',
        timestamp: eventTs,
      });
    }

    const slackThreadContext = threadTs
      ? await fetchSlackThreadContext(client, channelId, threadTs, eventTs)
      : undefined;
    const strippedText = stripSlackMentions(text);
    const requestText =
      strippedText ||
      (slackThreadContext ? 'Please answer based on the Slack thread history.' : '') ||
      'Say hello and ask how you can help.';
    const job: JobSpec = {
      jobId: createJobId('mention'),
      type: 'MENTION',
      repoKeys: [],
      gitRef: 'main',
      requestText,
      slack: {
        channelId,
        userId: userId ?? 'unknown',
        ...(threadTs ? { threadTs } : {}),
      },
      ...(slackThreadContext ? { slackThreadContext } : {}),
    };

    try {
      await saveJobQueued(job);
      await persistJobSpec(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist mention job');
      await postMessage(app, {
        channel: channelId,
        text: `I couldn't start that request. Please try again.`,
        threadTs,
      });
      return;
    }

    await enqueueJob(queue, job);

    // await postMessage(app, {
    //   channel: channelId,
    //   text: `Got it! I'm working on that now.`,
    //   threadTs,
    // });
  });

  app.view(slackIds.actions.askSubmit, async ({ ack, body, view, client }) => {
    await ack();

    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadTs?: string;
        })
      : undefined;
    const repoKeys = state.repos?.repo_keys?.selected_options?.map((opt) => opt.value) ?? [];
    const gitRef =
      state.branch?.git_ref?.value?.trim() ||
      resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const requestText = state.question?.request_text?.value ?? '';
    const resumeFromJobId = state.resume?.resume_from?.value?.trim() || undefined;

    if (!repoKeys.length) {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `Please select at least one repo for ${slackIds.commands.ask}.`,
      });
      return;
    }

    const slackThreadContext =
      metadata?.threadTs && metadata?.channelId
        ? await fetchSlackThreadContext(client, metadata.channelId, metadata.threadTs)
        : undefined;
    const job: JobSpec = {
      jobId: createJobId('ask'),
      type: 'ASK',
      repoKeys,
      primaryRepoKey: repoKeys[0]!,
      gitRef,
      requestText,
      slack: {
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadTs ? { threadTs: metadata.threadTs } : {}),
      },
      ...(slackThreadContext ? { slackThreadContext } : {}),
      ...(resumeFromJobId ? { resumeFromJobId } : {}),
    };

    let jobSpecPath: string | null = null;
    try {
      await saveJobQueued(job);
      jobSpecPath = await persistJobSpec(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't persist job ${job.jobId}. Please try again.`,
      });
      return;
    }

    await enqueueJob(queue, job);

    const ackResponse = await postMessage(app, {
      channel: metadata?.channelId ?? body.user.id,
      text: `Thanks! I've accepted job ${job.jobId}. I'll report back here.`,
      ...(metadata?.threadTs ? { threadTs: metadata.threadTs } : {}),
    });

    const ackThreadTs = metadata?.threadTs ?? ackResponse?.ts;
    if (ackThreadTs) {
      const requestSummary = requestText.trim() || 'No request text provided.';
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `*Job request*\n\`\`\`\n${requestSummary}\n\`\`\``,
        threadTs: ackThreadTs,
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to post job request');
      });
    }
    if (jobSpecPath) {
      const uploadSpecPath = await persistSlackUploadSpec(job);
      if (!uploadSpecPath) {
        logger.warn({ jobId: job.jobId }, 'Skipping job spec upload without sanitized artifact');
      } else {
        const jobSpecOptions = {
          channel: metadata?.channelId ?? body.user.id,
          filePath: uploadSpecPath,
          title: `sniptail-${job.jobId}-job-spec.json`,
        };
        await uploadFile(
          app,
          ackThreadTs ? { ...jobSpecOptions, threadTs: ackThreadTs } : jobSpecOptions,
        ).catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to upload job spec artifact');
        });
      }
    }

    if (!metadata?.threadTs && ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          slack: {
            ...job.slack,
            threadTs: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job thread timestamp');
      });
    }
  });

  app.view(slackIds.actions.implementSubmit, async ({ ack, body, view, client }) => {
    await ack();

    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadTs?: string;
        })
      : undefined;
    const repoKeys = state.repos?.repo_keys?.selected_options?.map((opt) => opt.value) ?? [];
    const gitRef =
      state.branch?.git_ref?.value?.trim() ||
      resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const requestText = state.change?.request_text?.value ?? '';
    const reviewers = parseCommaList(state.reviewers?.reviewers?.value ?? undefined);
    const labels = parseCommaList(state.labels?.labels?.value ?? undefined);
    const resumeFromJobId = state.resume?.resume_from?.value?.trim() || undefined;

    if (!repoKeys.length) {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `Please select at least one repo for ${slackIds.commands.implement}.`,
      });
      return;
    }

    const settings: JobSettings = {};
    if (reviewers) settings.reviewers = reviewers;
    if (labels) settings.labels = labels;

    const slackThreadContext =
      metadata?.threadTs && metadata?.channelId
        ? await fetchSlackThreadContext(client, metadata.channelId, metadata.threadTs)
        : undefined;
    const jobBase: JobSpec = {
      jobId: createJobId('implement'),
      type: 'IMPLEMENT',
      repoKeys,
      primaryRepoKey: repoKeys[0]!,
      gitRef,
      requestText,
      slack: {
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadTs ? { threadTs: metadata.threadTs } : {}),
      },
      ...(slackThreadContext ? { slackThreadContext } : {}),
      ...(resumeFromJobId ? { resumeFromJobId } : {}),
    };
    const job: JobSpec = Object.keys(settings).length ? { ...jobBase, settings } : jobBase;

    let jobSpecPath: string | null = null;
    try {
      await saveJobQueued(job);
      jobSpecPath = await persistJobSpec(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't persist job ${job.jobId}. Please try again.`,
      });
      return;
    }

    await enqueueJob(queue, job);

    const ackResponse = await postMessage(app, {
      channel: metadata?.channelId ?? body.user.id,
      text: `Thanks! I've accepted job ${job.jobId}. I'll report back here.`,
      ...(metadata?.threadTs ? { threadTs: metadata.threadTs } : {}),
    });

    const ackThreadTs = metadata?.threadTs ?? ackResponse?.ts;
    if (ackThreadTs) {
      const requestSummary = requestText.trim() || 'No request text provided.';
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `*Job request*\n\`\`\`\n${requestSummary}\n\`\`\``,
        threadTs: ackThreadTs,
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to post job request');
      });
    }
    if (jobSpecPath) {
      const uploadSpecPath = await persistSlackUploadSpec(job);
      if (!uploadSpecPath) {
        logger.warn({ jobId: job.jobId }, 'Skipping job spec upload without sanitized artifact');
      } else {
        const jobSpecOptions = {
          channel: metadata?.channelId ?? body.user.id,
          filePath: uploadSpecPath,
          title: `sniptail-${job.jobId}-job-spec.json`,
        };
        await uploadFile(
          app,
          ackThreadTs ? { ...jobSpecOptions, threadTs: ackThreadTs } : jobSpecOptions,
        ).catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to upload job spec artifact');
        });
      }
    }

    if (!metadata?.threadTs && ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          slack: {
            ...job.slack,
            threadTs: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job thread timestamp');
      });
    }
  });

  // eslint-disable-next-line @typescript-eslint/require-await
  app.error(async (err: CodedError) => {
    logger.error({ err }, 'Slack app error');
  });

  return app;
}
