import { extractOpenCodeTextParts } from '@sniptail/core/opencode/textParts.js';
import type {
  AgentSessionPreviewAdapter,
  AgentSessionPreviewAdapterResult,
} from '../agent-command/agentSessionPreviewAdapters.js';
import { createOpenCodeWorkerRuntime } from './openCodeWorkerRuntime.js';

function findLatestAssistantMessage(messages: unknown[]): AgentSessionPreviewAdapterResult {
  const latestAssistant = [...messages].reverse().find((message) => {
    if (!message || typeof message !== 'object') {
      return false;
    }
    return (message as { info?: { role?: unknown } }).info?.role === 'assistant';
  });
  if (!latestAssistant || typeof latestAssistant !== 'object') {
    return { errorMessage: 'No assistant message was found in the attached session.' };
  }

  const text = extractOpenCodeTextParts((latestAssistant as { parts?: unknown }).parts);
  if (!text) {
    return { errorMessage: 'The latest assistant message in the attached session has no text.' };
  }

  return { message: { role: 'agent', text } };
}

export const openCodeAgentSessionPreviewAdapter: AgentSessionPreviewAdapter = {
  provider: 'opencode',
  async previewSession(input): Promise<AgentSessionPreviewAdapterResult> {
    if (input.profile.provider !== 'opencode') {
      throw new Error(
        `Invalid OpenCode session preview profile provider: ${input.profile.provider}`,
      );
    }

    const workDir = input.resolvedWorkspace?.resolvedCwd ?? input.config.repoCacheRoot;
    const runtime = await createOpenCodeWorkerRuntime(
      `agent-session-preview-${input.profile.key}`,
      workDir,
      input.config,
      input.profile,
    );

    try {
      const response = await runtime.client.session.messages({
        sessionID: input.providerSessionId,
        directory: workDir,
        limit: 20,
      });
      if (response.error) {
        throw new Error(`OpenCode session messages failed: ${JSON.stringify(response.error)}`);
      }

      return findLatestAssistantMessage(response.data ?? []);
    } finally {
      await runtime.close();
    }
  },
};
