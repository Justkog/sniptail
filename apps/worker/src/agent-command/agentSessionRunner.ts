import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import type { AgentSessionRecord } from '@sniptail/core/agent-sessions/types.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
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

function resolveAgentProfile(
  config: WorkerConfig,
  agentProfileKey: string,
): InteractiveAgentProfile | undefined {
  const profile = config.agent.profiles[agentProfileKey];
  return profile ? { key: agentProfileKey, ...profile } : undefined;
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
  const { sessionId, response, workspaceKey, agentProfileKey, prompt, cwd } = event.payload;

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
    await notifier.postMessage(buildRef(response), 'This agent session already has an active prompt.');
    return;
  }

  await runAgentTurnLoop({
    turn: {
      sessionId,
      response,
      prompt,
      workspaceKey,
      profile,
      ...(cwd ? { cwd } : {}),
    },
    config,
    notifier,
    botEvents,
    env,
  });
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
          profile,
          config,
          notifier,
          env,
        });
        await notifier.postMessage(ref, 'Steering current prompt. Running this message next.');
      } catch (err) {
        cancelAgentFollowUpSteer(sessionId);
        logger.error({ err, sessionId }, 'Failed to steer active agent prompt');
        await notifier.postMessage(ref, `Failed to steer current prompt: ${(err as Error).message}`);
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
