import { extractAcpTextMessageChunk } from '@sniptail/core/acp/acpEventMapping.js';
import { launchAcpRuntime, type AcpRuntimeOptions } from '@sniptail/core/acp/acpRuntime.js';
import { debugFor } from '@sniptail/core/logger.js';
import type {
  AgentSessionPreviewAdapter,
  AgentSessionPreviewAdapterResult,
} from '../agent-command/agentSessionPreviewAdapters.js';

const debug = debugFor('acp:session-preview');

function normalizePreviewText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed ? text : undefined;
}

export const acpAgentSessionPreviewAdapter: AgentSessionPreviewAdapter = {
  provider: 'acp',
  async previewSession(input): Promise<AgentSessionPreviewAdapterResult> {
    if (input.profile.provider !== 'acp') {
      throw new Error(`Invalid ACP session preview profile provider: ${input.profile.provider}`);
    }

    const workDir = input.resolvedWorkspace?.resolvedCwd ?? input.config.repoCacheRoot;
    let activeRole: 'agent' | 'user' | undefined;
    let currentText = '';
    let latestMessage: { role: 'agent' | 'user'; text: string } | undefined;

    debug(
      {
        providerSessionId: input.providerSessionId,
        profileKey: input.profile.key,
        workDir,
        workspaceKey: input.workspaceKey,
        cwd: input.cwd,
        hasResolvedWorkspace: Boolean(input.resolvedWorkspace),
      },
      'Starting ACP session preview',
    );

    const onSessionUpdate: NonNullable<AcpRuntimeOptions['onSessionUpdate']> = (notification) => {
      const chunk = extractAcpTextMessageChunk(notification);
      if (!chunk) {
        return;
      }

      if (activeRole !== chunk.role) {
        activeRole = chunk.role;
        currentText = '';
      }

      currentText += chunk.text;
      latestMessage = {
        role: chunk.role,
        text: currentText,
      };
    };

    const runtime = await launchAcpRuntime({
      launch: input.profile,
      cwd: workDir,
      diagnostics: {
        configSource: `agent.profiles.${input.profile.key}`,
      },
      onSessionUpdate,
    });

    try {
      await runtime.loadSession(input.providerSessionId, {
        cwd: workDir,
        applySessionOverrides: false,
      });

      const text = normalizePreviewText(latestMessage?.text ?? '');
      if (!latestMessage || !text) {
        debug({ providerSessionId: input.providerSessionId }, 'No ACP preview text was replayed');
        return { errorMessage: 'No text message was found in the attached session.' };
      }

      debug(
        {
          providerSessionId: input.providerSessionId,
          role: latestMessage.role,
        },
        'Finished ACP session preview',
      );

      return {
        message: {
          role: latestMessage.role,
          text,
        },
      };
    } finally {
      await runtime.close();
    }
  },
};
