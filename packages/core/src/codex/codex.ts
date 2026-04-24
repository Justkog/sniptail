import {
  Codex,
  type ApprovalMode,
  type Input,
  type ModelReasoningEffort,
  type SandboxMode,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from '@openai/codex-sdk';
import { resolve } from 'node:path';
import os from 'node:os';
import { resolveWorkerAgentScriptPath } from '../agents/resolveWorkerAgentScriptPath.js';
import { buildPromptForJob } from '../agents/buildPrompt.js';
import { toEnvRecord } from '../agents/envRecord.js';
import type { JobSpec } from '../types/job.js';
import type { AgentAttachment } from '../agents/types.js';

export type CodexRunResult = {
  finalResponse: string;
  threadId?: string;
};

type DockerFilesystemMode = 'readonly' | 'writable';

export type CodexRunOptions = {
  onEvent?: (event: ThreadEvent) => void | Promise<void>;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  skipGitRepoCheck?: boolean;
  additionalDirectories?: string[];
  networkAccessEnabled?: boolean;
  webSearchEnabled?: boolean;
  botName?: string;
  resumeThreadId?: string;
  promptOverride?: string;
  currentTurnAttachments?: AgentAttachment[];
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  docker?: {
    enabled?: boolean;
    dockerfilePath?: string;
    image?: string;
    buildContext?: string;
  };
};

function extractFinalResponse(item: ThreadItem | undefined, current: string): string {
  if (!item) return current;
  if (item.type === 'agent_message') {
    return item.text;
  }
  return current;
}

function buildCodexInput(
  prompt: string,
  workDir: string,
  attachments: AgentAttachment[] | undefined,
): Input {
  const imageAttachments = (attachments ?? []).filter((attachment) =>
    attachment.mediaType.startsWith('image/'),
  );
  if (!imageAttachments.length) {
    return prompt;
  }

  return [
    { type: 'text', text: prompt },
    ...imageAttachments.map((attachment) => ({
      type: 'local_image' as const,
      path: resolve(workDir, attachment.path),
    })),
  ];
}

export async function runCodex(
  job: JobSpec,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: CodexRunOptions = {},
): Promise<CodexRunResult> {
  const codexEnv = toEnvRecord(env);
  const useDocker = options.docker?.enabled;
  const requestedSandboxMode = options.sandboxMode ?? 'workspace-write';
  const dockerFilesystemMode: DockerFilesystemMode =
    requestedSandboxMode === 'read-only' ? 'readonly' : 'writable';
  const sandboxMode = useDocker ? 'danger-full-access' : requestedSandboxMode;
  if (useDocker) {
    if (options.docker?.dockerfilePath) {
      codexEnv.CODEX_DOCKERFILE_PATH = resolve(options.docker.dockerfilePath);
    }
    if (options.docker?.image) {
      codexEnv.CODEX_DOCKER_IMAGE = options.docker.image;
    }
    if (options.docker?.buildContext) {
      codexEnv.CODEX_DOCKER_BUILD_CONTEXT = resolve(options.docker.buildContext);
    }
    codexEnv.CODEX_DOCKER_HOST_HOME = codexEnv.CODEX_DOCKER_HOST_HOME || os.homedir();
    codexEnv.CODEX_DOCKER_FILESYSTEM_MODE = dockerFilesystemMode;
  }
  const codexPathOverride = useDocker ? resolveWorkerAgentScriptPath('codex-docker.sh') : 'codex';

  const codex = new Codex({
    env: codexEnv,
    codexPathOverride,
  });
  const threadOptions: ThreadOptions = {
    workingDirectory: workDir,
    skipGitRepoCheck: options.skipGitRepoCheck ?? true,
    sandboxMode,
    approvalPolicy: options.approvalPolicy ?? 'never',
    ...(options.additionalDirectories
      ? { additionalDirectories: options.additionalDirectories }
      : {}),
    ...(options.networkAccessEnabled !== undefined
      ? { networkAccessEnabled: options.networkAccessEnabled }
      : {}),
    ...(options.webSearchEnabled !== undefined
      ? { webSearchEnabled: options.webSearchEnabled }
      : {}),
    ...(options.model && { model: options.model }),
    ...(options.modelReasoningEffort && { modelReasoningEffort: options.modelReasoningEffort }),
  };
  const thread = options.resumeThreadId
    ? codex.resumeThread(options.resumeThreadId, threadOptions)
    : codex.startThread(threadOptions);

  const botName = options.botName?.trim() || 'Sniptail';
  const basePrompt = options.promptOverride ?? buildPromptForJob(job, botName);
  const prompt = options.resumeThreadId
    ? `${basePrompt}\n\nResume note: Use the new working directory for this run: ${workDir}`
    : basePrompt;
  const { events } = await thread.runStreamed(
    buildCodexInput(prompt, workDir, options.currentTurnAttachments),
  );
  let finalResponse = '';
  let threadId = options.resumeThreadId;

  for await (const event of events) {
    if (options.onEvent) {
      await options.onEvent(event);
    }

    if (event.type === 'thread.started') {
      threadId = event.thread_id;
    }

    if (event.type === 'item.completed') {
      finalResponse = extractFinalResponse(event.item, finalResponse);
    }

    if (event.type === 'turn.failed') {
      throw new Error(`Codex turn failed: ${event.error.message}`);
    }

    if (event.type === 'error') {
      throw new Error(`Codex stream error: ${event.message}`);
    }
  }

  return {
    finalResponse,
    ...(threadId ? { threadId } : {}),
  };
}
