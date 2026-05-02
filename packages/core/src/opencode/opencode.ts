import {
  createOpencodeClient,
  createOpencodeServer,
  type Event as OpenCodeEvent,
  type Part,
} from '@opencode-ai/sdk/v2';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { buildPromptForJob } from '../agents/buildPrompt.js';
import { toEnvRecord } from '../agents/envRecord.js';
import { resolveWorkerAgentScriptPath } from '../agents/resolveWorkerAgentScriptPath.js';
import type { AgentAttachment, AgentRunOptions, AgentRunResult } from '../agents/types.js';
import type { JobSpec } from '../types/job.js';

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

type OpenCodeRuntime = {
  client: OpenCodeClient;
  baseUrl: string;
  close(): Promise<void> | void;
};

export type OpenCodeRuntimeReady = {
  baseUrl: string;
  sessionId: string;
  directory: string;
  executionMode: 'local' | 'server' | 'docker';
};

export type OpenCodePromptRunOptions = Omit<
  AgentRunOptions,
  'promptOverride' | 'resumeThreadId'
> & {
  sessionId?: string;
  runtimeId?: string;
  onSessionId?: (sessionId: string) => void | Promise<void>;
  onRuntimeReady?: (runtime: OpenCodeRuntimeReady) => void | Promise<void>;
  onAssistantMessageCompleted?: (text: string, event: OpenCodeEvent) => void | Promise<void>;
};

export type OpenCodeAbortOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
};

export type OpenCodePermissionReply = 'once' | 'always' | 'reject';

export type OpenCodePermissionReplyOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
  requestID: string;
  workspace?: string;
  reply: OpenCodePermissionReply;
  message?: string;
};

export type OpenCodeQuestionReplyOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
  requestID: string;
  workspace?: string;
  answers: string[][];
};

export type OpenCodeQuestionRejectOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
  requestID: string;
  workspace?: string;
};

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate OpenCode server port')));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function buildHeaders(env: NodeJS.ProcessEnv, options: AgentRunOptions): Record<string, string> {
  const headerEnv = options.opencode?.serverAuthHeaderEnv;
  if (!headerEnv) return {};
  const authHeader = env[headerEnv]?.trim();
  return authHeader ? { Authorization: authHeader } : {};
}

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
    .filter((part): part is Part & { type: 'text'; text: string } => part.type === 'text')
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

function getCompletedAssistantMessageInfo(
  event: OpenCodeEvent,
): { sessionID: string; messageID: string } | undefined {
  if (event.type !== 'message.updated') return undefined;
  const info = event.properties?.info;
  if (!info || typeof info !== 'object') return undefined;
  if (info.role !== 'assistant') return undefined;
  if (typeof info.id !== 'string' || typeof info.sessionID !== 'string') return undefined;
  if (typeof info.time?.completed !== 'number') return undefined;
  return { sessionID: info.sessionID, messageID: info.id };
}

export async function fetchCompletedAssistantMessageText(
  client: OpenCodeClient,
  event: OpenCodeEvent,
): Promise<string> {
  const completed = getCompletedAssistantMessageInfo(event);
  if (!completed) return '';
  const message = await client.session.message({
    sessionID: completed.sessionID,
    messageID: completed.messageID,
  });
  if (message.error) {
    throw new Error(`OpenCode message failed: ${JSON.stringify(message.error)}`);
  }
  const assistantMessage = message.data;

  return extractText(assistantMessage?.parts);
}

function getEventSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const typed = event as { properties?: Record<string, unknown> };
  const properties = typed.properties;
  if (!properties) return undefined;
  if (typeof properties.sessionID === 'string') return properties.sessionID;
  const info = properties.info;
  if (
    info &&
    typeof info === 'object' &&
    typeof (info as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (info as { sessionID: string }).sessionID;
  }
  const part = properties.part;
  if (
    part &&
    typeof part === 'object' &&
    typeof (part as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (part as { sessionID: string }).sessionID;
  }
  return undefined;
}

async function streamEvents(
  client: OpenCodeClient,
  sessionID: string,
  workDir: string,
  signal: AbortSignal,
  onEvent: ((event: OpenCodeEvent) => void | Promise<void>) | undefined,
  onAssistantMessageCompleted:
    | ((text: string, event: OpenCodeEvent) => void | Promise<void>)
    | undefined,
): Promise<void> {
  if (!onEvent && !onAssistantMessageCompleted) return;
  try {
    const subscription = await client.event.subscribe({ directory: workDir }, { signal });
    for await (const event of subscription.stream as AsyncGenerator<OpenCodeEvent>) {
      if (signal.aborted) return;
      const eventSessionId = getEventSessionId(event);
      if (eventSessionId && eventSessionId !== sessionID) continue;
      await onEvent?.(event);
      if (onAssistantMessageCompleted) {
        const assistantText = await fetchCompletedAssistantMessageText(client, event);
        if (assistantText) {
          await onAssistantMessageCompleted(assistantText, event);
        }
      }
    }
  } catch {
    if (!signal.aborted) {
      // await onEvent?.({
      //   type: 'session.error',
      //   properties: { sessionID, error: String((err as { message?: unknown })?.message ?? err) },
      // });
    }
  }
}

async function createLocalRuntime(
  workDir: string,
  options: AgentRunOptions,
): Promise<OpenCodeRuntime> {
  const port = await getFreePort();
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port,
    timeout: options.opencode?.startupTimeoutMs ?? 10_000,
  });
  return {
    baseUrl: server.url,
    client: createOpencodeClient({ baseUrl: server.url, directory: workDir }),
    close: () => server.close(),
  };
}

function spawnDockerServer(
  runtimeId: string,
  workDir: string,
  port: number,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
): ChildProcess {
  const opencodeEnv = toEnvRecord(env);
  const docker = options.opencode?.docker;
  if (docker?.dockerfilePath) {
    opencodeEnv.OPENCODE_DOCKERFILE_PATH = resolve(docker.dockerfilePath);
  }
  if (docker?.image) {
    opencodeEnv.OPENCODE_DOCKER_IMAGE = docker.image;
  }
  if (docker?.buildContext) {
    opencodeEnv.OPENCODE_DOCKER_BUILD_CONTEXT = resolve(docker.buildContext);
  }
  const sanitizedJobId = runtimeId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  opencodeEnv.OPENCODE_DOCKER_CONTAINER_NAME =
    opencodeEnv.OPENCODE_DOCKER_CONTAINER_NAME ||
    `snatch-opencode-${sanitizedJobId}-${process.pid}-${Date.now()}`;
  opencodeEnv.OPENCODE_DOCKER_HOST_PORT = String(port);
  opencodeEnv.OPENCODE_DOCKER_WORKDIR = workDir;
  opencodeEnv.OPENCODE_DOCKER_WORKDIR_MODE =
    options.sandboxMode === 'read-only' ? 'readonly' : 'writable';
  opencodeEnv.OPENCODE_DOCKER_ADDITIONAL_DIRS = (options.additionalDirectories ?? []).join('\n');
  opencodeEnv.OPENCODE_DOCKER_HOST_HOME = opencodeEnv.OPENCODE_DOCKER_HOST_HOME || os.homedir();

  return spawn(resolveWorkerAgentScriptPath('opencode-docker-server.sh'), [], {
    env: opencodeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForServer(
  client: OpenCodeClient,
  workDir: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await client.config.get({ directory: workDir });
      if (!response.error) return;
      lastError = response.error;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for OpenCode server: ${String(lastError)}`);
}

async function createDockerRuntime(
  runtimeId: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
): Promise<OpenCodeRuntime> {
  const port = await getFreePort();
  const proc = spawnDockerServer(runtimeId, workDir, port, env, options);
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = createOpencodeClient({ baseUrl, directory: workDir });
  let exited = false;
  let output = '';

  proc.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    output += text;
    if (options.opencode?.dockerStreamLogs) {
      process.stdout.write(text);
    }
  });
  proc.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    output += text;
    if (options.opencode?.dockerStreamLogs) {
      process.stderr.write(text);
    }
  });
  proc.once('exit', (code) => {
    exited = true;
    if (code !== 0) {
      output += `\nOpenCode docker server exited with code ${code}`;
    }
  });

  await waitForServer(client, workDir, options.opencode?.startupTimeoutMs ?? 10_000).catch(
    (err) => {
      proc.kill('SIGTERM');
      throw new Error(`${(err as Error).message}\n${output.trim()}`);
    },
  );

  return {
    baseUrl,
    client,
    close: () => {
      if (!exited) {
        proc.kill('SIGTERM');
      }
    },
  };
}

function createServerRuntime(
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
): OpenCodeRuntime {
  const baseUrl = options.opencode?.serverUrl;
  if (!baseUrl) {
    throw new Error('[opencode].server_url is required when execution_mode="server".');
  }
  const client = createOpencodeClient({
    baseUrl,
    directory: workDir,
    headers: buildHeaders(env, options),
  });
  return { baseUrl, client, close: () => undefined };
}

function createClientForBaseUrl(
  baseUrl: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodeAbortOptions,
): OpenCodeClient {
  return createOpencodeClient({
    baseUrl,
    directory: workDir,
    headers: buildHeaders(env, options),
  });
}

async function createRuntime(
  runtimeId: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
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
      : await runtime.client.session.create({ directory: workDir }).then((response) => {
          if (response.error) {
            throw new Error(`OpenCode session create failed: ${JSON.stringify(response.error)}`);
          }
          if (!response.data?.id) {
            throw new Error('OpenCode session create failed: missing session id');
          }
          return response.data;
        });
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
      options.onAssistantMessageCompleted,
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

export async function abortOpenCodeSession(
  sessionID: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodeAbortOptions = {},
): Promise<void> {
  const baseUrl = options.baseUrl ?? options.opencode?.serverUrl;
  if (!baseUrl) {
    throw new Error('OpenCode abort requires an active runtime URL or [opencode].server_url.');
  }
  const client = createClientForBaseUrl(baseUrl, workDir, env, options);
  const response = await client.session.abort({ sessionID, directory: workDir });
  if (response.error) {
    throw new Error(`OpenCode abort failed: ${JSON.stringify(response.error)}`);
  }
}

export async function replyOpenCodePermission(
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodePermissionReplyOptions,
): Promise<void> {
  const baseUrl = options.baseUrl ?? options.opencode?.serverUrl;
  if (!baseUrl) {
    throw new Error(
      'OpenCode permission reply requires an active runtime URL or [opencode].server_url.',
    );
  }
  const client = createClientForBaseUrl(baseUrl, workDir, env, options);
  const response = await client.permission.reply({
    requestID: options.requestID,
    directory: workDir,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    reply: options.reply,
    ...(options.message ? { message: options.message } : {}),
  });
  if (response.error) {
    throw new Error(`OpenCode permission reply failed: ${JSON.stringify(response.error)}`);
  }
}

export async function replyOpenCodeQuestion(
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodeQuestionReplyOptions,
): Promise<void> {
  const baseUrl = options.baseUrl ?? options.opencode?.serverUrl;
  if (!baseUrl) {
    throw new Error(
      'OpenCode question reply requires an active runtime URL or [opencode].server_url.',
    );
  }
  const client = createClientForBaseUrl(baseUrl, workDir, env, options);
  const response = await client.question.reply({
    requestID: options.requestID,
    directory: workDir,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    answers: options.answers,
  });
  if (response.error) {
    throw new Error(`OpenCode question reply failed: ${JSON.stringify(response.error)}`);
  }
}

export async function rejectOpenCodeQuestion(
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodeQuestionRejectOptions,
): Promise<void> {
  const baseUrl = options.baseUrl ?? options.opencode?.serverUrl;
  if (!baseUrl) {
    throw new Error(
      'OpenCode question reject requires an active runtime URL or [opencode].server_url.',
    );
  }
  const client = createClientForBaseUrl(baseUrl, workDir, env, options);
  const response = await client.question.reject({
    requestID: options.requestID,
    directory: workDir,
    ...(options.workspace ? { workspace: options.workspace } : {}),
  });
  if (response.error) {
    throw new Error(`OpenCode question reject failed: ${JSON.stringify(response.error)}`);
  }
}
