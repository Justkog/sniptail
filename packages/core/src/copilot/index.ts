import { CopilotClient, type SessionEvent } from '@github/copilot-sdk';
import { buildAskPrompt, buildImplementPrompt, buildMentionPrompt } from '../codex/prompts.js';
import type { JobSpec } from '../types/job.js';
import type { AgentRunOptions, AgentRunResult } from '../agents/types.js';

function buildPrompt(job: JobSpec, botName: string): string {
  return job.type === 'ASK'
    ? buildAskPrompt(job, botName)
    : job.type === 'IMPLEMENT'
      ? buildImplementPrompt(job, botName)
      : buildMentionPrompt(job, botName);
}

export async function runCopilot(
  job: JobSpec,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const client = new CopilotClient({ cwd: workDir, env });
  let sessionId: string | undefined;
  let finalResponse = '';
  let started = false;

  try {
    await client.start();
    started = true;

    console.debug(options.resumeThreadId ? 'Resuming Copilot session' : 'Creating new Copilot session');

    const session = options.resumeThreadId
      ? await client.resumeSession(options.resumeThreadId)
      : await client.createSession({
        // model: 'GPT-5 mini'
    });

    sessionId = session.sessionId;

    session.on((event: SessionEvent) => {
      if (options.onEvent) {
        void Promise.resolve(options.onEvent(event)).catch(() => undefined);
      }
      if (event.type === 'assistant.message') {
        finalResponse = event.data.content ?? finalResponse;
      }
    });

    const botName = options.botName?.trim() || 'Sniptail';
    const prompt = buildPrompt(job, botName);

    const response = (await session.sendAndWait({ prompt }));
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
