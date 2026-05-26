import { extractOpenCodeTextParts } from '@sniptail/core/opencode/textParts.js';
import { debugFor } from '@sniptail/core/logger.js';
import type {
  AgentSessionPreviewAdapter,
  AgentSessionPreviewAdapterResult,
} from '../agent-command/agentSessionPreviewAdapters.js';
import { createOpenCodeWorkerRuntime } from './openCodeWorkerRuntime.js';

const debug = debugFor('opencode:session-preview');

type OpenCodeWorkerRuntime = Awaited<ReturnType<typeof createOpenCodeWorkerRuntime>>;
type OpenCodeSessionMessagesResponse = Awaited<
  ReturnType<OpenCodeWorkerRuntime['client']['session']['messages']>
>;
type OpenCodeSessionMessage = NonNullable<OpenCodeSessionMessagesResponse['data']>[number];
type OpenCodeAssistantSessionMessage = OpenCodeSessionMessage & {
  info: Extract<OpenCodeSessionMessage['info'], { role: 'assistant' }>;
};

function isAssistantMessage(
  message: OpenCodeSessionMessage,
): message is OpenCodeAssistantSessionMessage {
  return message.info.role === 'assistant';
}

function findLatestAssistantMessage(
  messages: OpenCodeSessionMessage[],
): AgentSessionPreviewAdapterResult {
  const latestAssistant = [...messages].reverse().find(isAssistantMessage);
  if (!latestAssistant) {
    debug(
      { messageCount: messages.length },
      'No assistant message found in OpenCode session preview',
    );
    return { errorMessage: 'No assistant message was found in the attached session.' };
  }

  const text = extractOpenCodeTextParts(latestAssistant.parts);
  if (!text) {
    debug({ messageCount: messages.length }, 'OpenCode assistant preview message had no text');
    return { errorMessage: 'The latest assistant message in the attached session has no text.' };
  }

  const createdAt = readOpenCodeMessageCreatedAt(latestAssistant);
  return {
    message: {
      role: 'agent',
      text,
      ...(createdAt ? { createdAt } : {}),
    },
  };
}

function readOpenCodeMessageCreatedAt(
  message: OpenCodeAssistantSessionMessage,
): string | undefined {
  const timestamp = message.info.time?.created ?? message.info.time?.completed;
  if (!Number.isFinite(timestamp)) {
    debug('OpenCode preview message did not include usable time metadata');
    return undefined;
  }

  const createdAt = new Date(timestamp).toISOString();
  debug({ timestamp, createdAt }, 'Resolved OpenCode preview message timestamp');
  return createdAt;
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
    debug(
      {
        providerSessionId: input.providerSessionId,
        profileKey: input.profile.key,
        workDir,
        workspaceKey: input.workspaceKey,
        cwd: input.cwd,
        hasResolvedWorkspace: Boolean(input.resolvedWorkspace),
      },
      'Starting OpenCode session preview',
    );
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

      const result = findLatestAssistantMessage(response.data ?? []);
      debug(
        {
          providerSessionId: input.providerSessionId,
          hasMessage: Boolean(result.message),
          hasCreatedAt: Boolean(result.message?.createdAt),
          errorMessage: result.errorMessage,
        },
        'Finished OpenCode session preview',
      );
      return result;
    } finally {
      await runtime.close();
    }
  },
};
