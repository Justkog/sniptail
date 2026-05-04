import { logger } from '@sniptail/core/logger.js';
import { updateAgentSessionStatus } from '@sniptail/core/agent-sessions/registry.js';
import type {
  InteractiveAgentAdapter,
  InteractiveAgentProvider,
} from './interactiveAgentTypes.js';
import {
  resolveOpenCodeAgentInteraction,
  runOpenCodeAgentTurn,
  steerOpenCodeAgentTurn,
  stopOpenCodeAgentPrompt,
} from '../opencode/openCodeInteractiveAgent.js';

function unsupportedInteractiveAgentError(displayName: string): Error {
  return new Error(`${displayName} interactive agent sessions are not supported yet.`);
}

function createUnsupportedAdapter(
  provider: InteractiveAgentProvider,
  displayName: string,
): InteractiveAgentAdapter {
  const fail = async (sessionId: string, err: Error) => {
    await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
      logger.warn({ err: updateErr, sessionId }, 'Failed to mark agent session failed');
    });
  };

  const throwUnsupported = async (
    sessionId: string,
    notifierPost: (message: string) => Promise<void>,
  ) => {
    const err = unsupportedInteractiveAgentError(displayName);
    await fail(sessionId, err);
    await notifierPost(err.message);
  };

  return {
    provider,
    displayName,
    runTurn: async ({ turn, notifier }) => {
      const ref = {
        provider: turn.response.provider,
        channelId: turn.response.channelId,
        ...(turn.response.threadId ? { threadId: turn.response.threadId } : {}),
      };
      await throwUnsupported(turn.sessionId, (message) => notifier.postMessage(ref, message));
    },
    steerActiveTurn: async ({ sessionId, response, notifier }) => {
      const ref = {
        provider: response.provider,
        channelId: response.channelId,
        ...(response.threadId ? { threadId: response.threadId } : {}),
      };
      await throwUnsupported(sessionId, (message) => notifier.postMessage(ref, message));
    },
    stopPrompt: async ({ event, notifier }) => {
      const ref = {
        provider: event.payload.response.provider,
        channelId: event.payload.response.channelId,
        ...(event.payload.response.threadId ? { threadId: event.payload.response.threadId } : {}),
      };
      await notifier.postMessage(ref, unsupportedInteractiveAgentError(displayName).message);
    },
    resolveInteraction: async ({ event, notifier }) => {
      const ref = {
        provider: event.payload.response.provider,
        channelId: event.payload.response.channelId,
        ...(event.payload.response.threadId ? { threadId: event.payload.response.threadId } : {}),
      };
      await notifier.postMessage(ref, unsupportedInteractiveAgentError(displayName).message);
    },
  };
}

const copilotInteractiveAgent = createUnsupportedAdapter('copilot', 'Copilot');

const openCodeInteractiveAgent: InteractiveAgentAdapter = {
  provider: 'opencode',
  displayName: 'OpenCode',
  runTurn: runOpenCodeAgentTurn,
  steerActiveTurn: steerOpenCodeAgentTurn,
  stopPrompt: stopOpenCodeAgentPrompt,
  resolveInteraction: resolveOpenCodeAgentInteraction,
};

export const INTERACTIVE_AGENT_REGISTRY: Record<InteractiveAgentProvider, InteractiveAgentAdapter> =
  {
    opencode: openCodeInteractiveAgent,
    copilot: copilotInteractiveAgent,
  };

export function getInteractiveAgentAdapter(provider: InteractiveAgentProvider) {
  return INTERACTIVE_AGENT_REGISTRY[provider];
}
