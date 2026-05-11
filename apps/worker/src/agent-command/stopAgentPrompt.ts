import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import { getInteractiveAgentAdapter } from './interactiveAgentRegistry.js';

export type StopAgentPromptOptions = {
  event: CoreWorkerEvent<'agent.prompt.stop'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

export async function stopAgentPrompt({
  event,
  config,
  notifier,
  botEvents,
  env = process.env,
}: StopAgentPromptOptions): Promise<void> {
  const { sessionId, response } = event.payload;
  const ref = {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, threadId: response.threadId, userId: response.userId },
      'Ignoring agent prompt stop because agent command is disabled in worker config',
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
  await adapter.stopPrompt({
    event,
    session,
    profile: { key: session.agentProfileKey, ...profile },
    config,
    notifier,
    botEvents,
    env,
  });
}
