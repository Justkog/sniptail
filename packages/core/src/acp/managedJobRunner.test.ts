import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { JobSpec } from '../types/job.js';

const hoisted = vi.hoisted(() => ({
  launchAcpRuntime: vi.fn(),
}));

vi.mock('./acpRuntime.js', () => ({
  launchAcpRuntime: hoisted.launchAcpRuntime,
}));

import { runAcp } from './managedJobRunner.js';

function buildJob(type: JobSpec['type'] = 'ASK'): JobSpec {
  return {
    jobId: 'job-1',
    type,
    repoKeys: ['repo-1'],
    gitRef: 'main',
    requestText: 'Inspect the repository.',
    channel: {
      provider: 'slack',
      channelId: 'C123',
      userId: 'U123',
    },
  };
}

describe('runAcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a session, streams assistant text through ACP events, and returns the session id', async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const prompt = vi.fn(async () => {
      const launchArgs = hoisted.launchAcpRuntime.mock.calls[0]?.[0] as {
        onSessionUpdate?: (notification: unknown) => Promise<void>;
      };
      await launchArgs.onSessionUpdate?.({
        sessionId: 'acp-session-1',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [],
        },
      });
      await launchArgs.onSessionUpdate?.({
        sessionId: 'acp-session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello ' },
        },
      });
      await launchArgs.onSessionUpdate?.({
        sessionId: 'acp-session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'world' },
        },
      });
    });
    const close = vi.fn().mockResolvedValue(undefined);
    hoisted.launchAcpRuntime.mockResolvedValue({
      createSession,
      prompt,
      close,
    });
    const onEvent = vi.fn();

    const result = await runAcp(buildJob(), '/tmp/work', { ACP_TOKEN: 'abc' }, {
      botName: 'Sniptail',
      additionalDirectories: ['/tmp/repo-cache'],
      acp: {
        agent: 'opencode',
        command: ['opencode', 'acp'],
        profile: 'build',
      },
      onEvent,
    });

    const launchCall = hoisted.launchAcpRuntime.mock.calls[0]?.[0] as {
      cwd: string;
      env: NodeJS.ProcessEnv;
      launch: { agent?: string; command: string[]; profile?: string };
      onSessionUpdate?: unknown;
    };
    expect(launchCall).toMatchObject({
      cwd: '/tmp/work',
      env: { ACP_TOKEN: 'abc' },
      launch: {
        agent: 'opencode',
        command: ['opencode', 'acp'],
        profile: 'build',
      },
    });
    expect(typeof launchCall.onSessionUpdate).toBe('function');
    expect(createSession).toHaveBeenCalledWith({
      cwd: '/tmp/work',
      additionalDirectories: ['/tmp/repo-cache'],
    });
    const promptCall = prompt.mock.calls[0]?.[0] as { prompt: string };
    expect(promptCall.prompt).toContain('Inspect the repository.');
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      finalResponse: 'hello world',
      threadId: 'acp-session-1',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses promptOverride when provided', async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const loadSession = vi.fn();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    hoisted.launchAcpRuntime.mockResolvedValue({
      createSession,
      loadSession,
      prompt,
      close,
    });

    await runAcp(buildJob(), '/tmp/work', {}, {
      promptOverride: 'Use this exact prompt.',
      acp: {
        command: ['opencode', 'acp'],
      },
    });

    expect(prompt).toHaveBeenCalledWith({
      prompt: 'Use this exact prompt.',
    });
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('loads an existing ACP session for managed-job continuation', async () => {
    const createSession = vi.fn();
    const loadSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-9' });
    const prompt = vi.fn(async () => {
      const launchArgs = hoisted.launchAcpRuntime.mock.calls[0]?.[0] as {
        onSessionUpdate?: (notification: unknown) => Promise<void>;
      };
      await launchArgs.onSessionUpdate?.({
        sessionId: 'acp-session-9',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'continued response' },
        },
      });
    });
    const close = vi.fn().mockResolvedValue(undefined);
    hoisted.launchAcpRuntime.mockResolvedValue({
      createSession,
      loadSession,
      prompt,
      close,
    });

    const result = await runAcp(buildJob(), '/tmp/work', {}, {
      resumeThreadId: 'acp-session-9',
      additionalDirectories: ['/tmp/repo-cache'],
      acp: {
        command: ['opencode', 'acp'],
      },
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(loadSession).toHaveBeenCalledWith('acp-session-9', {
      cwd: '/tmp/work',
      additionalDirectories: ['/tmp/repo-cache'],
    });
    const resumedPromptCall = prompt.mock.calls[0]?.[0] as { prompt: string };
    expect(resumedPromptCall.prompt).toContain('Inspect the repository.');
    expect(result).toEqual({
      finalResponse: 'continued response',
      threadId: 'acp-session-9',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the runtime when prompt execution fails', async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const loadSession = vi.fn();
    const prompt = vi.fn().mockRejectedValue(new Error('prompt failed'));
    const close = vi.fn().mockResolvedValue(undefined);
    hoisted.launchAcpRuntime.mockResolvedValue({
      createSession,
      loadSession,
      prompt,
      close,
    });

    await expect(
      runAcp(buildJob(), '/tmp/work', {}, {
        acp: {
          command: ['opencode', 'acp'],
        },
      }),
    ).rejects.toThrow('prompt failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('bubbles ACP session/load failures and still closes the runtime', async () => {
    const createSession = vi.fn();
    const loadSession = vi
      .fn()
      .mockRejectedValue(
        new Error('ACP agent does not support session/load; cannot load session acp-session-9.'),
      );
    const prompt = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    hoisted.launchAcpRuntime.mockResolvedValue({
      createSession,
      loadSession,
      prompt,
      close,
    });

    await expect(
      runAcp(buildJob(), '/tmp/work', {}, {
        resumeThreadId: 'acp-session-9',
        acp: {
          command: ['opencode', 'acp'],
        },
      }),
    ).rejects.toThrow(
      'ACP agent does not support session/load; cannot load session acp-session-9.',
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(loadSession).toHaveBeenCalledWith('acp-session-9', {
      cwd: '/tmp/work',
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
