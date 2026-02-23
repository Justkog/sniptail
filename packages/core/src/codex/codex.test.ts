import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';
import { runCodex } from './codex.js';

const hoisted = vi.hoisted(() => {
  const codexCtor = vi.fn();
  const startThread = vi.fn();
  const resumeThread = vi.fn();
  const runStreamed = vi.fn();
  const resolveWorkerAgentScriptPath = vi.fn(() => '/tmp/codex-docker.sh');
  const buildPromptForJob = vi.fn(() => 'mock prompt');

  class CodexMock {
    constructor(options: unknown) {
      codexCtor(options);
    }

    startThread(options: unknown) {
      startThread(options);
      return { runStreamed };
    }

    resumeThread(threadId: string, options: unknown) {
      resumeThread(threadId, options);
      return { runStreamed };
    }
  }

  return {
    CodexMock,
    codexCtor,
    startThread,
    resumeThread,
    runStreamed,
    resolveWorkerAgentScriptPath,
    buildPromptForJob,
  };
});

vi.mock('@openai/codex-sdk', () => ({
  Codex: hoisted.CodexMock,
}));

vi.mock('../agents/resolveWorkerAgentScriptPath.js', () => ({
  resolveWorkerAgentScriptPath: hoisted.resolveWorkerAgentScriptPath,
}));

vi.mock('../agents/buildPrompt.js', () => ({
  buildPromptForJob: hoisted.buildPromptForJob,
}));

function toEvents(values: unknown[]) {
  return (async function* () {
    for (const value of values) {
      await Promise.resolve();
      yield value;
    }
  })();
}

function buildJob(type: JobSpec['type']): JobSpec {
  return {
    jobId: 'job-1',
    type,
    repoKeys: ['repo-one'],
    gitRef: 'main',
    requestText: 'test request',
    channel: {
      provider: 'slack',
      channelId: 'C123',
      userId: 'U123',
    },
  };
}

describe('runCodex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.runStreamed.mockResolvedValue({
      events: toEvents([
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
        { type: 'turn.completed' },
      ]),
    });
  });

  it('uses system codex binary in local mode', async () => {
    const result = await runCodex(buildJob('ASK'), '/tmp/work', {}, {});

    expect(result).toEqual({
      finalResponse: 'done',
      threadId: 'thread-1',
    });
    expect(hoisted.codexCtor).toHaveBeenCalledTimes(1);
    expect(hoisted.codexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPathOverride: 'codex',
      }),
    );
    expect(hoisted.resolveWorkerAgentScriptPath).not.toHaveBeenCalled();
  });

  it('uses docker wrapper path in docker mode', async () => {
    await runCodex(buildJob('ASK'), '/tmp/work', {}, { docker: { enabled: true } });

    expect(hoisted.resolveWorkerAgentScriptPath).toHaveBeenCalledWith('codex-docker.sh');
    expect(hoisted.codexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPathOverride: '/tmp/codex-docker.sh',
      }),
    );
  });
});
