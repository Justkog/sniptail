import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentAttachment } from '@sniptail/core/agents/types.js';
import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import type { AgentSessionRecord } from '@sniptail/core/agent-sessions/types.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import {
  beginAgentPromptTurn,
  cancelAgentFollowUpSteer,
  clearAgentPromptTurn,
  enqueueAgentFollowUp,
  finishAgentPromptTurn,
  isAgentPromptTurnActive,
  steerAgentFollowUp,
  type QueuedAgentFollowUp,
} from './activeAgentPromptTurns.js';
import { getInteractiveAgentAdapter } from './interactiveAgentRegistry.js';
import type {
  AgentSessionTurn,
  InteractiveAgentProfile,
  RunInteractiveAgentTurnInput,
} from './interactiveAgentTypes.js';

export type RunAgentSessionStartOptions = {
  event: CoreWorkerEvent<'agent.session.start'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

export type RunAgentSessionMessageOptions = {
  event: CoreWorkerEvent<'agent.session.message'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

function buildRef(response: CoreWorkerEvent<'agent.session.start'>['payload']['response']) {
  return {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
}

type AgentMessageResponseProvider =
  CoreWorkerEvent<'agent.session.message'>['payload']['response']['provider'];

function resolveAgentMessageReactionName(provider: AgentMessageResponseProvider): string | undefined {
  switch (provider) {
    case 'discord':
      return '💭';
    case 'slack':
      return 'thought_balloon';
    default: {
      const exhaustiveCheck: never = provider;
      return exhaustiveCheck;
    }
  }
}

async function addAgentMessageProcessingReaction(
  notifier: Notifier,
  input: {
    sessionId: string;
    response: CoreWorkerEvent<'agent.session.message'>['payload']['response'];
    messageId?: string;
  },
): Promise<void> {
  if (!input.messageId) {
    return;
  }

  const reactionName = resolveAgentMessageReactionName(input.response.provider);
  if (!reactionName) {
    return;
  }

  try {
    await notifier.addReaction(
      {
        provider: input.response.provider,
        channelId: input.response.channelId,
        ...(input.response.threadId ? { threadId: input.response.threadId } : {}),
      },
      reactionName,
      { messageId: input.messageId },
    );
  } catch (err) {
    logger.warn(
      { err, sessionId: input.sessionId, messageId: input.messageId },
      'Failed to add agent session message reaction before processing',
    );
  }
}

function resolveAgentProfile(
  config: WorkerConfig,
  agentProfileKey: string,
): InteractiveAgentProfile | undefined {
  const profile = config.agent.profiles[agentProfileKey];
  return profile ? { key: agentProfileKey, ...profile } : undefined;
}

function sanitizeAttachmentFileName(fileName: string, index: number): string {
  const baseName = basename(fileName).trim() || `attachment-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${baseName.replace(/[\\/]/g, '_')}`;
}

async function materializeTurnContextFiles(
  contextFiles: JobContextFile[] | undefined,
): Promise<{ directory?: string; attachments?: AgentAttachment[] }> {
  if (!contextFiles?.length) {
    return {};
  }

  const directory = await mkdtemp(join(tmpdir(), 'sniptail-agent-files-'));
  const attachments: AgentAttachment[] = [];

  for (const [index, contextFile] of contextFiles.entries()) {
    const filePath = join(directory, sanitizeAttachmentFileName(contextFile.originalName, index));
    await writeFile(filePath, Buffer.from(contextFile.contentBase64, 'base64'));
    attachments.push({
      path: filePath,
      displayName: contextFile.originalName,
      mediaType: contextFile.mediaType,
    });
  }

  return { directory, attachments };
}

function buildCodexNonImageContextNote(
  attachments: AgentAttachment[] | undefined,
): string | undefined {
  if (!attachments?.length) return undefined;
  const nonImageAttachments = attachments.filter(
    (attachment) => !attachment.mediaType.startsWith('image/'),
  );
  if (!nonImageAttachments.length) return undefined;
  const listedPaths = nonImageAttachments.map((attachment) => `- ${attachment.path}`).join('\n');
  return [
    '',
    'Additional user-provided files are available for this turn:',
    listedPaths,
    '',
    'Use them if relevant.',
  ].join('\n');
}

async function runAgentTurnLoop(input: RunInteractiveAgentTurnInput) {
  let nextTurn: AgentSessionTurn | undefined = input.turn;

  while (nextTurn) {
    const adapter = getInteractiveAgentAdapter(nextTurn.profile.provider);
    await adapter.runTurn({
      ...input,
      turn: nextTurn,
    });

    const queued = finishAgentPromptTurn(nextTurn.sessionId);
    if (!queued) {
      nextTurn = undefined;
      continue;
    }

    const session = await loadAgentSession(queued.sessionId);
    if (!session || session.status === 'stopped' || session.status === 'failed') {
      clearAgentPromptTurn(queued.sessionId);
      nextTurn = undefined;
      continue;
    }

    const profile = resolveAgentProfile(input.config, session.agentProfileKey);
    if (!profile) {
      await input.notifier.postMessage(
        buildRef(queued.response),
        `Unknown agent profile key: ${session.agentProfileKey}`,
      );
      clearAgentPromptTurn(queued.sessionId);
      nextTurn = undefined;
      continue;
    }

    nextTurn = {
      sessionId: queued.sessionId,
      response: queued.response,
      prompt: queued.message,
      workspaceKey: session.workspaceKey,
      profile,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      ...(session.codingAgentSessionId
        ? { codingAgentSessionId: session.codingAgentSessionId }
        : {}),
    };
  }
}

async function loadRunnableSession(
  sessionId: string,
  ref: ReturnType<typeof buildRef>,
  notifier: Notifier,
): Promise<AgentSessionRecord | undefined> {
  const session = await loadAgentSession(sessionId);
  if (!session) {
    await notifier.postMessage(ref, 'Agent session not found.');
    return undefined;
  }
  if (session.status === 'pending') {
    await notifier.postMessage(ref, 'This agent session is still waiting to start.');
    return undefined;
  }
  if (session.status !== 'completed' && session.status !== 'active') {
    await notifier.postMessage(ref, `This agent session is ${session.status}.`);
    return undefined;
  }
  return session;
}

export async function runAgentSessionStart({
  event,
  config,
  notifier,
  botEvents,
  env = process.env,
}: RunAgentSessionStartOptions): Promise<void> {
  const { sessionId, response, workspaceKey, agentProfileKey, prompt, cwd, contextFiles } =
    event.payload;

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, workspaceKey, profileKey: agentProfileKey },
      'Ignoring agent session start because agent command is disabled in worker config',
    );
    return;
  }

  const profile = resolveAgentProfile(config, agentProfileKey);
  if (!profile) {
    await notifier.postMessage(buildRef(response), `Unknown agent profile key: ${agentProfileKey}`);
    return;
  }

  if (!beginAgentPromptTurn(sessionId)) {
    await notifier.postMessage(
      buildRef(response),
      'This agent session already has an active prompt.',
    );
    return;
  }

  let tempContextDirectory: string | undefined;
  try {
    const materialized = await materializeTurnContextFiles(contextFiles);
    const codexNote =
      profile.provider === 'codex'
        ? buildCodexNonImageContextNote(materialized.attachments)
        : undefined;
    const filteredAttachments =
      profile.provider === 'codex'
        ? materialized.attachments?.filter((attachment) =>
            attachment.mediaType.startsWith('image/'),
          )
        : materialized.attachments;
    tempContextDirectory = materialized.directory;

    await runAgentTurnLoop({
      turn: {
        sessionId,
        response,
        prompt: codexNote ? `${prompt}${codexNote}` : prompt,
        workspaceKey,
        profile,
        ...(cwd ? { cwd } : {}),
        ...(filteredAttachments?.length ? { currentTurnAttachments: filteredAttachments } : {}),
        ...(tempContextDirectory ? { additionalDirectories: [tempContextDirectory] } : {}),
      },
      config,
      notifier,
      botEvents,
      env,
    });
  } catch (err) {
    clearAgentPromptTurn(sessionId);
    throw err;
  } finally {
    if (tempContextDirectory) {
      await rm(tempContextDirectory, { recursive: true, force: true }).catch((err) => {
        logger.warn(
          { err, sessionId, tempContextDirectory },
          'Failed to remove temporary agent attachment directory',
        );
      });
    }
  }
}

export async function runAgentSessionMessage({
  event,
  config,
  notifier,
  botEvents,
  env = process.env,
}: RunAgentSessionMessageOptions): Promise<void> {
  const { sessionId, response, message, messageId, mode = 'run' } = event.payload;
  const ref = buildRef(response);

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, threadId: response.threadId, userId: response.userId },
      'Ignoring agent session message because agent command is disabled in worker config',
    );
    return;
  }

  const followUp: QueuedAgentFollowUp = {
    sessionId,
    response,
    message,
    ...(messageId ? { messageId } : {}),
  };

  const session = await loadRunnableSession(sessionId, ref, notifier);
  if (!session) return;

  const profile = resolveAgentProfile(config, session.agentProfileKey);
  if (!profile) {
    await notifier.postMessage(ref, `Unknown agent profile key: ${session.agentProfileKey}`);
    return;
  }

  const adapter = getInteractiveAgentAdapter(profile.provider);

  if (isAgentPromptTurnActive(sessionId)) {
    if (mode === 'queue' || mode === 'steer') {
      await addAgentMessageProcessingReaction(notifier, {
        sessionId,
        response,
        ...(messageId ? { messageId } : {}),
      });
    }

    let handledByAdapter = false;
    try {
      handledByAdapter =
        (await adapter.handleActiveMessage?.({
          sessionId,
          response,
          message,
          mode,
          profile,
          config,
          notifier,
          env,
        })) ?? false;
    } catch (err) {
      logger.error({ err, sessionId, mode }, 'Failed to handle active agent prompt message');
      await notifier.postMessage(ref, `Failed to steer current prompt: ${(err as Error).message}`);
      return;
    }
    if (handledByAdapter) {
      await notifier.postMessage(
        ref,
        mode === 'queue'
          ? 'Follow-up queued for the current Copilot session.'
          : 'Steering current prompt.',
      );
      return;
    }

    if (mode === 'queue') {
      enqueueAgentFollowUp(followUp);
      await notifier.postMessage(ref, 'Follow-up queued for the next agent turn.');
      return;
    }
    if (mode === 'steer') {
      steerAgentFollowUp(followUp);
      try {
        await adapter.steerActiveTurn({
          sessionId,
          response,
          message,
          profile,
          config,
          notifier,
          env,
        });
        await notifier.postMessage(ref, 'Steering current prompt. Running this message next.');
      } catch (err) {
        cancelAgentFollowUpSteer(sessionId);
        logger.error({ err, sessionId }, 'Failed to steer active agent prompt');
        await notifier.postMessage(
          ref,
          `Failed to steer current prompt: ${(err as Error).message}`,
        );
      }
      return;
    }
    await notifier.postMessage(ref, 'This agent session already has an active prompt.');
    return;
  }

  if (!session.codingAgentSessionId) {
    await notifier.postMessage(
      ref,
      `${adapter.displayName} session id is not available for this agent session.`,
    );
    return;
  }
  if (!beginAgentPromptTurn(sessionId)) {
    await notifier.postMessage(ref, 'This agent session already has an active prompt.');
    return;
  }

  await addAgentMessageProcessingReaction(notifier, {
    sessionId,
    response,
    ...(messageId ? { messageId } : {}),
  });

  await runAgentTurnLoop({
    turn: {
      sessionId,
      response,
      prompt: message,
      workspaceKey: session.workspaceKey,
      profile,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      codingAgentSessionId: session.codingAgentSessionId,
    },
    config,
    notifier,
    botEvents,
    env,
  });
}
