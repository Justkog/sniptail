import type { Input, ThreadEvent, ThreadOptions, TurnOptions } from '@openai/codex-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';
import { runCodex } from './codex.js';

type CodexConstructorOptions = {
  codexPathOverride: string;
  env: Record<string, string>;
  config?: unknown;
};

type RunStreamedResult = {
  events: AsyncIterable<ThreadEvent>;
};

const hoisted = vi.hoisted(() => {
  const codexCtor = vi.fn<(options: CodexConstructorOptions) => void>();
  const runStreamed = vi.fn<(input: Input, options?: TurnOptions) => Promise<RunStreamedResult>>();
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
    expect(hoisted.runStreamed).toHaveBeenCalledWith('mock prompt', expect.any(Object));
    expect(hoisted.resolveWorkerAgentScriptPath).not.toHaveBeenCalled();
  });

  it('passes config.profile to Codex when configProfile is provided', async () => {
    await runCodex(buildJob('ASK'), '/tmp/work', {}, { configProfile: 'deep-review' });

    expect(hoisted.codexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { profile: 'deep-review' },
      }),
    );
    const threadOptions = hoisted.startThread.mock.calls[0]?.[0];
    expect(threadOptions?.approvalPolicy).toBeUndefined();
    expect(threadOptions?.sandboxMode).toBeUndefined();
  });

  it('lets explicit sandbox and approval options override config.profile defaults', async () => {
    await runCodex(buildJob('ASK'), '/tmp/work', {}, {
      approvalPolicy: 'on-request',
      configProfile: 'deep-review',
      sandboxMode: 'read-only',
    });

    expect(hoisted.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only',
      }),
    );
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

    expect(hoisted.runStreamed).toHaveBeenCalledWith(
      [
        { type: 'text', text: 'mock prompt' },
        { type: 'local_image', path: '/tmp/work/context/diagram.png' },
      ],
      expect.any(Object),
    );
  });

  it('passes an abort signal to runStreamed and exposes an abortable runtime', async () => {
    const onTurnReady = vi.fn();

    await runCodex(buildJob('ASK'), '/tmp/work', {}, { codex: { onTurnReady } });

    const firstRunStreamedCall = hoisted.runStreamed.mock.calls[0];
    expect(firstRunStreamedCall).toBeDefined();
    const runStreamedOptions = firstRunStreamedCall?.[1];
    expect(runStreamedOptions?.signal).toBeInstanceOf(AbortSignal);
    const runtime = onTurnReady.mock.calls[0]?.[0] as
      | {
          abort: () => void;
        }
      | undefined;
    expect(typeof runtime?.abort).toBe('function');
    runtime?.abort();
    expect(runStreamedOptions?.signal?.aborted).toBe(true);
  });

  it('refreshes the active runtime when the thread id becomes available', async () => {
    const onTurnReady = vi.fn();

    await runCodex(buildJob('ASK'), '/tmp/work', {}, { codex: { onTurnReady } });

    expect(onTurnReady).toHaveBeenCalledTimes(2);
    const firstRuntime = onTurnReady.mock.calls[0]?.[0] as
      | { abort?: unknown; threadId?: unknown }
      | undefined;
    const secondRuntime = onTurnReady.mock.calls[1]?.[0] as
      | { abort?: unknown; threadId?: unknown }
      | undefined;
    expect(typeof firstRuntime?.abort).toBe('function');
    expect(secondRuntime?.threadId).toBe('thread-1');
    expect(typeof secondRuntime?.abort).toBe('function');
  });
});
