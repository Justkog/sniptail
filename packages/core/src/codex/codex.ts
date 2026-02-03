import {
  Codex,
  type ApprovalMode,
  type ModelReasoningEffort,
  type SandboxMode,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from '@openai/codex-sdk';
import { resolve } from 'node:path';
import os from 'node:os';
import {
  buildAskPrompt,
  buildImplementPrompt,
  buildMentionPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from './prompts.js';
import type { JobSpec } from '../types/job.js';

export type CodexRunResult = {
  finalResponse: string;
  threadId?: string;
};

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
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  docker?: {
    enabled?: boolean;
    dockerfilePath?: string;
    image?: string;
    buildContext?: string;
  };
};

function toEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      record[key] = value;
    }
  }
  return record;
}

function extractFinalResponse(item: ThreadItem | undefined, current: string): string {
  if (!item) return current;
  if (item.type === 'agent_message') {
    return item.text;
  }
  return current;
}

export async function runCodex(
  job: JobSpec,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: CodexRunOptions = {},
): Promise<CodexRunResult> {
  const codexEnv = toEnvRecord(env);
  const useDocker = options.docker?.enabled;
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
  }

  const codex = new Codex({
    env: codexEnv,
    ...(useDocker
      ? { codexPathOverride: resolve(process.cwd(), 'scripts', 'codex-docker.sh') }
      : {}),
  });
  const threadOptions: ThreadOptions = {
    workingDirectory: workDir,
    skipGitRepoCheck: options.skipGitRepoCheck ?? true,
    sandboxMode: options.sandboxMode ?? 'workspace-write',
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
  const basePrompt =
    job.type === 'ASK'
      ? buildAskPrompt(job, botName)
      : job.type === 'IMPLEMENT'
        ? buildImplementPrompt(job, botName)
        : job.type === 'PLAN'
          ? buildPlanPrompt(job, botName)
          : job.type === 'REVIEW'
            ? buildReviewPrompt(job, botName)
            : buildMentionPrompt(job, botName);
  const prompt = options.resumeThreadId
    ? `${basePrompt}\n\nResume note: Use the new working directory for this run: ${workDir}`
    : basePrompt;
  const { events } = await thread.runStreamed(prompt);
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
