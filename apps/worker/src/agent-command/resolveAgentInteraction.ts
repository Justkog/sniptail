import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import { getInteractiveAgentAdapter } from './interactiveAgentRegistry.js';

export type ResolveAgentInteractionOptions = {
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

export async function resolveAgentInteraction({
  event,
  config,
  notifier,
  botEvents,
  env = process.env,
}: ResolveAgentInteractionOptions): Promise<void> {
  const { sessionId, interactionId, response } = event.payload;
  const ref = {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, interactionId, threadId: response.threadId, userId: response.userId },
      'Ignoring agent interaction resolution because agent command is disabled in worker config',
    );
    return;
  }

  const session = await loadAgentSession(sessionId);
  if (!session) {
    await notifier.postMessage(ref, 'Agent session not found.');
    return;
  }
  if (session.status !== 'active') {
    await notifier.postMessage(ref, `This agent session is ${session.status}.`);
    return;
  }

  const profile = config.agent.profiles[session.agentProfileKey];
  if (!profile) {
    await notifier.postMessage(ref, `Unknown agent profile key: ${session.agentProfileKey}`);
    return;
  }

  const adapter = getInteractiveAgentAdapter(profile.provider);
  await adapter.resolveInteraction({
    event,
    session,
    profile: { key: session.agentProfileKey, ...profile },
    config,
    notifier,
    botEvents,
    env,
  });
}
