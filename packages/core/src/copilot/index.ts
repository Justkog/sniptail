import { CopilotClient, type SessionEvent } from '@github/copilot-sdk';
import { resolve } from 'node:path';
import { buildAskPrompt, buildImplementPrompt, buildMentionPrompt } from '../codex/prompts.js';
import { logger } from '../logger.js';
import type { JobSpec } from '../types/job.js';
import type { AgentRunOptions, AgentRunResult } from '../agents/types.js';
import continuationPromptSource from './prompts/continue.md?raw';

function toEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      record[key] = value;
    }
  }
  return record;
}

function buildPrompt(job: JobSpec, botName: string): string {
  return job.type === 'ASK'
    ? buildAskPrompt(job, botName)
    : job.type === 'IMPLEMENT'
      ? buildImplementPrompt(job, botName)
      : buildMentionPrompt(job, botName);
}

const continuationPrompt = continuationPromptSource.trimEnd();

function isIdleTimeout(err: unknown): boolean {
  return String((err as { message?: unknown })?.message ?? err).includes('session.idle');
}

export async function runCopilot(
  job: JobSpec,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const copilotEnv = toEnvRecord(env);
  const docker = options.copilot?.docker;
  if (docker?.enabled) {
    if (docker.dockerfilePath) {
      copilotEnv.GH_COPILOT_DOCKERFILE_PATH = resolve(docker.dockerfilePath);
    }
    if (docker.image) {
      copilotEnv.GH_COPILOT_DOCKER_IMAGE = docker.image;
    }
    if (docker.buildContext) {
      copilotEnv.GH_COPILOT_DOCKER_BUILD_CONTEXT = resolve(docker.buildContext);
    }
  }

  const client = new CopilotClient({
    cwd: workDir,
    env: copilotEnv,
    ...(options.copilot?.cliPath ? { cliPath: options.copilot.cliPath } : {}),
  });
  let sessionId: string | undefined;
  let finalResponse = '';
  let started = false;

  try {
    await client.start();
    started = true;

    console.debug(
      options.resumeThreadId ? 'Resuming Copilot session' : 'Creating new Copilot session',
    );

    let session = options.resumeThreadId
      ? await client.resumeSession(options.resumeThreadId)
      : await client.createSession({
          // model: 'GPT-5 mini'
        });

    sessionId = session.sessionId;

    const registerSessionHandlers = (activeSession: typeof session) => {
      activeSession.on((event: SessionEvent) => {
        if (options.onEvent) {
          void Promise.resolve(options.onEvent(event)).catch(() => undefined);
        }
        if (event.type === 'assistant.message') {
          finalResponse = event.data.content ?? finalResponse;
        }
      });
    };

    registerSessionHandlers(session);

    const botName = options.botName?.trim() || 'Sniptail';
    const prompt = buildPrompt(job, botName);
    const maxIdleRetries = options.copilotIdleRetries ?? 2;
    let attempt = 0;
    let response: SessionEvent | undefined;

    while (true) {
      try {
        response = await session.sendAndWait({
          prompt: attempt === 0 ? prompt : continuationPrompt,
        });
        break;
      } catch (err) {
        if (isIdleTimeout(err) && sessionId && attempt < maxIdleRetries) {
          attempt += 1;
          logger.warn(
            { err, sessionId, attempt, maxIdleRetries },
            'Copilot session idle timeout; retrying with resumed session.',
          );
          try {
            await session.destroy();
          } catch {
            // Ignore cleanup errors for a likely-dead session.
          }
          session = await client.resumeSession(sessionId);
          sessionId = session.sessionId;
          registerSessionHandlers(session);
          continue;
        }
        throw err;
      }
    }

    if (response?.type === 'assistant.message') {
      finalResponse = response.data.content ?? finalResponse;
    }

    await session.destroy();
  } finally {
    if (started) {
      await client.stop();
    }
  }

  return {
    finalResponse,
    ...(sessionId ? { threadId: sessionId } : {}),
  };
}
