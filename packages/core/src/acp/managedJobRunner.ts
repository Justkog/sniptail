import { buildPromptForJob } from '../agents/buildPrompt.js';
import type { AgentRunOptions, AgentRunResult } from '../agents/types.js';
import { logger } from '../logger.js';
import type { JobSpec } from '../types/job.js';
import { extractAcpAssistantText } from './acpEventMapping.js';
import { launchAcpRuntime } from './acpRuntime.js';
import type { AcpRequestPermissionRequest, AcpRequestPermissionResponse } from './types.js';

type AcpSessionHandle = { sessionId: string };

function findAllowOption(
  request: AcpRequestPermissionRequest,
  kind: 'allow_always' | 'allow_once',
) {
  return request.options.find((option) => option.kind === kind);
}

function allowManagedJobPermission(
  request: AcpRequestPermissionRequest,
): AcpRequestPermissionResponse {
  const option =
    findAllowOption(request, 'allow_always') ?? findAllowOption(request, 'allow_once');

  if (!option) {
    logger.warn(
      {
        sessionId: request.sessionId,
        toolCallId: request.toolCall.toolCallId,
        toolTitle: request.toolCall.title,
        optionKinds: request.options.map((candidate) => candidate.kind),
      },
      'ACP managed job permission request did not provide an allow option',
    );
    return {
      outcome: {
        outcome: 'cancelled',
      },
    };
  }

  return {
    outcome: {
      outcome: 'selected',
      optionId: option.optionId,
    },
  };
}

export async function runAcp(
  job: JobSpec,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  if (!options.acp) {
    throw new Error('ACP managed-job execution requires ACP launch configuration.');
  }

  const botName = options.botName?.trim() || 'Sniptail';
  const prompt = options.promptOverride ?? buildPromptForJob(job, botName);
  let finalResponse = '';
  let isCapturingAssistantOutput = false;

  const runtime = await launchAcpRuntime({
    cwd: workDir,
    env,
    launch: options.acp,
    diagnostics: {
      configSource: '[acp]',
    },
    onRequestPermission: (request) => allowManagedJobPermission(request),
    onSessionUpdate: async (notification) => {
      await options.onEvent?.(notification);
      const assistantText = extractAcpAssistantText(notification);
      if (!assistantText || !isCapturingAssistantOutput) {
        return;
      }
      finalResponse += assistantText;
    },
  });

  try {
    const sessionOptions = {
      cwd: workDir,
      ...(options.additionalDirectories?.length
        ? { additionalDirectories: options.additionalDirectories }
        : {}),
    };
    const threadId = options.resumeThreadId
      ? options.resumeThreadId
      : (await runtime.createSession(sessionOptions) as AcpSessionHandle).sessionId;
    if (options.resumeThreadId) {
      await runtime.loadSession(options.resumeThreadId, sessionOptions);
    }
    isCapturingAssistantOutput = true;
    await runtime.prompt({ prompt });
    isCapturingAssistantOutput = false;

    return {
      finalResponse,
      threadId,
    };
  } finally {
    await runtime.close();
  }
}
