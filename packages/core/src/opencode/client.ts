import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import type { AgentRunOptions } from '../agents/types.js';

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

export function buildOpenCodeHeaders(
  env: NodeJS.ProcessEnv | undefined,
  options: Pick<AgentRunOptions, 'opencode'> = {},
): Record<string, string> {
  const headerEnv = options.opencode?.serverAuthHeaderEnv;
  if (!headerEnv) return {};
  const authHeader = env?.[headerEnv]?.trim();
  return authHeader ? { Authorization: authHeader } : {};
}

export function createOpenCodeClient(
  baseUrl: string,
  workDir: string,
  env?: NodeJS.ProcessEnv,
  options: Pick<AgentRunOptions, 'opencode'> = {},
): ReturnType<typeof createOpencodeClient> {
  const headers = buildOpenCodeHeaders(env, options);
  return createOpencodeClient({
    baseUrl,
    directory: workDir,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });
}

function createClientForBaseUrl(
  baseUrl: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenCodeAbortOptions,
): ReturnType<typeof createOpencodeClient> {
  return createOpenCodeClient(baseUrl, workDir, env, options);
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
