import { CopilotClient, type SessionConfig, type SessionEvent } from '@github/copilot-sdk';
import { execFile } from 'node:child_process';
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
  const containerNameEnvKey = 'GH_COPILOT_DOCKER_CONTAINER_NAME';
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
    const sanitizedJobId = job.jobId.replace(/[^a-zA-Z0-9_.-]/g, '-');
    copilotEnv.GH_COPILOT_DOCKER_CONTAINER_NAME =
      copilotEnv.GH_COPILOT_DOCKER_CONTAINER_NAME ||
      `snatch-copilot-${sanitizedJobId}-${process.pid}-${Date.now()}`;
  }
  const containerName =
    docker?.enabled && copilotEnv[containerNameEnvKey]
      ? copilotEnv[containerNameEnvKey]
      : undefined;

  const client = new CopilotClient({
    cwd: workDir,
    env: copilotEnv,
    autoRestart: false,
    ...(options.copilot?.cliPath ? { cliPath: options.copilot.cliPath } : {}),
  });
  let sessionId: string | undefined;
  let finalResponse = '';
  let started = false;
  let fatalError: Error | undefined;

  try {
    await client.start();
    started = true;

    console.debug(
      options.resumeThreadId ? 'Resuming Copilot session' : 'Creating new Copilot session',
    );

    const createOptions: SessionConfig = options.model ? { model: options.model } : {};
    let session = options.resumeThreadId
      ? await client.resumeSession(options.resumeThreadId)
      : await client.createSession(createOptions);

    sessionId = session.sessionId;

    const registerSessionHandlers = (activeSession: typeof session) => {
      activeSession.on((event: SessionEvent) => {
        if (options.onEvent) {
          void Promise.resolve(options.onEvent(event)).catch(() => undefined);
        }
        if (event.type === 'assistant.message') {
          finalResponse = event.data.content ?? finalResponse;
        }
        if (event.type === 'session.error') {
          const message =
            typeof event.data?.message === 'string' ? event.data.message : 'unknown error';
          fatalError = new Error(`Copilot session error: ${message}`);
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
        if (fatalError) {
          throw fatalError;
        }
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
      // Copilot CLI can linger after a stop request, so enforce a timeout and force-stop if needed.
      const stopTimeoutMs = 5_000;
      const stopErrors = await Promise.race([
        client.stop(),
        new Promise<Error[]>((resolve) => {
          setTimeout(() => resolve([new Error('Copilot stop timeout')]), stopTimeoutMs);
        }),
      ]);
      if (stopErrors.length > 0) {
        try {
          await client.forceStop();
        } catch {
          // Ignore force stop errors; cleanup continues below.
        }
      }
      if (docker?.enabled && containerName) {
        // Ensure the named container is stopped/removed even if the CLI doesn't exit cleanly.
        await new Promise<void>((resolve) => {
          execFile('docker', ['stop', containerName], () => resolve());
        });
        await new Promise<void>((resolve) => {
          execFile('docker', ['rm', '-f', containerName], () => resolve());
        });
      }
    }
  }

  return {
    finalResponse,
    ...(sessionId ? { threadId: sessionId } : {}),
  };
}
