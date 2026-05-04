import { type Event as OpenCodeEvent, type Part, type TextPart } from '@opencode-ai/sdk/v2';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPromptForJob } from '../agents/buildPrompt.js';
import type { AgentAttachment, AgentRunOptions, AgentRunResult } from '../agents/types.js';
import type { JobSpec } from '../types/job.js';
import {
  createDockerRuntime,
  createLocalRuntime,
  createServerRuntime,
  type OpenCodeClient,
  type OpenCodeRuntime,
  type OpenCodeRuntimeReady,
} from './runtime.js';
export {
  abortOpenCodeSession,
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
} from './client.js';
import { streamEvents } from './events.js';

export type OpenCodePromptRunOptions = Omit<
  AgentRunOptions,
  'promptOverride' | 'resumeThreadId' | 'onEvent'
> & {
  sessionId?: string;
  runtimeId?: string;
  onEvent?: (event: OpenCodeEvent) => void | Promise<void>;
  onSessionId?: (sessionId: string) => void | Promise<void>;
  onRuntimeReady?: (runtime: OpenCodeRuntimeReady) => void | Promise<void>;
  onAssistantMessage?: (text: string, event: OpenCodeEvent) => void | Promise<void>;
};

function buildPrompt(job: JobSpec, workDir: string, options: AgentRunOptions): string {
  const botName = options.botName?.trim() || 'Sniptail';
  const basePrompt = options.promptOverride ?? buildPromptForJob(job, botName);
  if (!options.resumeThreadId) return basePrompt;
  return `${basePrompt}\n\nResume note: Use the new working directory for this run: ${workDir}`;
}

function buildPromptParts(prompt: string, attachments?: AgentAttachment[]) {
  return [
    { type: 'text' as const, text: prompt },
    ...(attachments ?? []).map((attachment) => ({
      type: 'file' as const,
      mime: attachment.mediaType,
      filename: attachment.displayName || basename(attachment.path),
      url: pathToFileURL(resolve(attachment.path)).href,
    })),
  ];
}

function extractText(parts: Part[] | undefined): string {
  return (parts ?? [])
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

async function fallbackFinalResponse(
  client: OpenCodeClient,
  sessionID: string,
  workDir: string,
): Promise<string> {
  const messages = await client.session.messages({ sessionID, directory: workDir, limit: 20 });
  if (messages.error) {
    throw new Error(`OpenCode messages failed: ${JSON.stringify(messages.error)}`);
  }
  const latestAssistant = [...(messages.data ?? [])]
    .reverse()
    .find((message) => message.info.role === 'assistant');
  return extractText(latestAssistant?.parts);
}

async function createRuntime(
  runtimeId: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: Pick<AgentRunOptions, 'opencode'>,
): Promise<OpenCodeRuntime> {
  switch (options.opencode?.executionMode ?? 'local') {
    case 'server':
      return createServerRuntime(workDir, env, options);
    case 'docker':
      return createDockerRuntime(runtimeId, workDir, env, options);
    case 'local':
    default:
      return createLocalRuntime(workDir, options);
  }
}

export async function runOpenCodePrompt(
  prompt: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodePromptRunOptions = {},
): Promise<AgentRunResult> {
  const runtime = await createRuntime(
    options.runtimeId ?? 'opencode-prompt',
    workDir,
    env,
    options,
  );
  const abortController = new AbortController();
  let eventStream: Promise<void> | undefined;

  try {
    const session = options.sessionId
      ? { id: options.sessionId }
      : await (async () => {
          const sessionResponse = await runtime.client.session.create({ directory: workDir });
          if (sessionResponse.error) {
            throw new Error(
              `OpenCode session create failed: ${JSON.stringify(sessionResponse.error)}`,
            );
          }
          if (!sessionResponse.data?.id) {
            throw new Error('OpenCode session create failed: missing session id');
          }
          return sessionResponse.data;
        })();
    await options.onSessionId?.(session.id);
    await options.onRuntimeReady?.({
      baseUrl: runtime.baseUrl,
      sessionId: session.id,
      directory: workDir,
      executionMode: options.opencode?.executionMode ?? 'local',
    });

    eventStream = streamEvents(
      runtime.client,
      session.id,
      workDir,
      abortController.signal,
      options.onEvent,
      options.onAssistantMessage,
    );

    const promptResponse = await runtime.client.session.prompt({
      sessionID: session.id,
      directory: workDir,
      ...(options.modelProvider && options.model
        ? { model: { providerID: options.modelProvider, modelID: options.model } }
        : {}),
      ...(options.opencode?.agent ? { agent: options.opencode.agent } : {}),
      parts: buildPromptParts(prompt, options.currentTurnAttachments),
    });
    if (promptResponse.error) {
      throw new Error(`OpenCode prompt failed: ${JSON.stringify(promptResponse.error)}`);
    }

    const finalResponse =
      extractText(promptResponse.data?.parts) ||
      (await fallbackFinalResponse(runtime.client, session.id, workDir));

    return {
      finalResponse,
      threadId: session.id,
    };
  } finally {
    abortController.abort();
    await eventStream?.catch(() => undefined);
    await runtime.close();
  }
}

export async function runOpenCode(
  job: JobSpec,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  return runOpenCodePrompt(buildPrompt(job, workDir, options), workDir, env, {
    ...options,
    runtimeId: job.jobId,
    ...(options.resumeThreadId ? { sessionId: options.resumeThreadId } : {}),
  });
}
