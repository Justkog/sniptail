import type { Input, ThreadEvent, ThreadOptions } from '@openai/codex-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';
import { runCodex } from './codex.js';

type CodexConstructorOptions = {
  codexPathOverride: string;
  env: Record<string, string>;
};

type RunStreamedResult = {
  events: AsyncIterable<ThreadEvent>;
};

const hoisted = vi.hoisted(() => {
  const codexCtor = vi.fn<(options: CodexConstructorOptions) => void>();
  const runStreamed = vi.fn<(input: Input) => Promise<RunStreamedResult>>();
  const startThread = vi.fn<(options: ThreadOptions) => { runStreamed: typeof runStreamed }>();
  const resumeThread =
    vi.fn<(threadId: string, options: ThreadOptions) => { runStreamed: typeof runStreamed }>();
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

function toEvents(values: ThreadEvent[]): AsyncIterable<ThreadEvent> {
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
        env: {},
      }),
    );
    expect(hoisted.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: 'workspace-write',
      }),
    );
    expect(hoisted.runStreamed).toHaveBeenCalledWith('mock prompt');
    expect(hoisted.resolveWorkerAgentScriptPath).not.toHaveBeenCalled();
  });

  it('uses docker wrapper path in docker mode', async () => {
    await runCodex(buildJob('ASK'), '/tmp/work', {}, { docker: { enabled: true } });

    const dockerCodexOptions = hoisted.codexCtor.mock.calls[0]?.[0];

    expect(hoisted.resolveWorkerAgentScriptPath).toHaveBeenCalledWith('codex-docker.sh');
    expect(dockerCodexOptions).toBeDefined();
    expect(dockerCodexOptions?.codexPathOverride).toBe('/tmp/codex-docker.sh');
    expect(dockerCodexOptions?.env.CODEX_DOCKER_FILESYSTEM_MODE).toBe('writable');
    expect(hoisted.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: 'danger-full-access',
      }),
    );
  });

  it('maps explicit read-only sandbox requests to docker readonly mode', async () => {
    await runCodex(
      buildJob('MENTION'),
      '/tmp/work',
      {},
      {
        docker: { enabled: true },
        sandboxMode: 'read-only',
      },
    );

    const dockerCodexOptions = hoisted.codexCtor.mock.calls[0]?.[0];

    expect(dockerCodexOptions).toBeDefined();
    expect(dockerCodexOptions?.env.CODEX_DOCKER_FILESYSTEM_MODE).toBe('readonly');
    expect(hoisted.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: 'danger-full-access',
      }),
    );
  });

  it('passes only current-turn images as native Codex attachments', async () => {
    await runCodex(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        currentTurnAttachments: [
          {
            path: 'context/diagram.png',
            displayName: 'diagram.png',
            mediaType: 'image/png',
          },
          {
            path: 'context/notes.md',
            displayName: 'notes.md',
            mediaType: 'text/markdown',
          },
        ],
      },
    );

    expect(hoisted.runStreamed).toHaveBeenCalledWith([
      { type: 'text', text: 'mock prompt' },
      { type: 'local_image', path: '/tmp/work/context/diagram.png' },
    ]);
  });
});
