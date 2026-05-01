import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { OpenCodePromptRunOptions } from '@sniptail/core/opencode/opencode.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';

const hoisted = vi.hoisted(() => ({
  runOpenCodePrompt: vi.fn(),
  loadAgentSession: vi.fn(),
  updateAgentSessionCodingAgentSessionId: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}));

vi.mock('@sniptail/core/opencode/opencode.js', () => ({
  runOpenCodePrompt: hoisted.runOpenCodePrompt,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
  updateAgentSessionCodingAgentSessionId: hoisted.updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

import { clearActiveOpenCodeRuntimes, getActiveOpenCodeRuntime } from './activeOpenCodeRuntimes.js';
import { runAgentSessionStart } from './openCodePromptRunner.js';

function buildConfig(workspacePath: string): WorkerConfig {
  return {
    botName: 'Sniptail',
    queueDriver: 'inproc',
    jobRegistryDriver: 'sqlite',
    jobRegistryPath: ':memory:',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    repoCacheRoot: '/tmp/repos',
    primaryAgent: 'opencode',
    jobConcurrency: 1,
    bootstrapConcurrency: 1,
    workerEventConcurrency: 1,
    copilot: {
      executionMode: 'local',
      idleRetries: 3,
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
      defaultModel: {
        provider: 'anthropic',
        model: 'claude-sonnet',
      },
    },
    includeRawRequestInMr: false,
    agent: {
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      interactionTimeoutMs: 1_800_000,
      outputDebounceMs: 15_000,
      workspaces: {
        snatch: {
          path: workspacePath,
          label: 'Snatch',
        },
      },
      profiles: {
        build: {
          provider: 'opencode',
          name: 'build',
          label: 'Build',
        },
      },
    },
    run: {
      actions: {},
    },
    codex: {
      executionMode: 'local',
    },
  };
}

function buildEvent(overrides: Partial<CoreWorkerEvent<'agent.session.start'>['payload']> = {}) {
  return {
    schemaVersion: 1,
    type: 'agent.session.start',
    payload: {
      sessionId: 'session-1',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
      prompt: 'inspect this',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      ...overrides,
    },
  } satisfies CoreWorkerEvent<'agent.session.start'>;
}

function buildNotifier(): Notifier & { postMessage: ReturnType<typeof vi.fn> } {
  return {
    postMessage: vi.fn(),
    uploadFile: vi.fn(),
    addReaction: vi.fn(),
  };
}

type AssistantCompletedEvent = Parameters<
  NonNullable<OpenCodePromptRunOptions['onAssistantMessageCompleted']>
>[1];

function buildAssistantCompletedEvent(): AssistantCompletedEvent {
  return {
    type: 'message.updated',
    properties: {
      info: {
        id: 'message-1',
        sessionID: 'opencode-session-1',
        role: 'assistant',
        time: { created: 1, completed: Date.now() },
        parentID: 'parent-1',
        modelID: 'claude-sonnet',
        providerID: 'anthropic',
        mode: 'build',
        path: { cwd: '/tmp/work', root: '/tmp/work' },
        cost: 0,
        tokens: {
          input: 1,
          output: 1,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    },
  };
}

describe('OpenCode agent prompt runner', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(join(tmpdir(), 'sniptail-agent-runner-'));
    hoisted.runOpenCodePrompt.mockImplementation(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onSessionId?.('opencode-session-1');
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'message.updated',
          properties: { info: { role: 'assistant', time: { completed: Date.now() } } },
        });
        await options.onAssistantMessageCompleted?.(
          'assistant progress text',
          buildAssistantCompletedEvent(),
        );
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.updateAgentSessionCodingAgentSessionId.mockResolvedValue(undefined);
    hoisted.loadAgentSession.mockResolvedValue({ status: 'active' });
  });

  afterEach(async () => {
    clearActiveOpenCodeRuntimes();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('resolves workspace cwd and runs OpenCode with the selected profile', async () => {
    await mkdir(join(tempRoot, 'apps', 'worker'), { recursive: true });
    const notifier = buildNotifier();

    await runAgentSessionStart({
      event: buildEvent({ cwd: 'apps/worker' }),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).toHaveBeenCalledWith(
      'inspect this',
      join(tempRoot, 'apps', 'worker'),
      {},
      expect.objectContaining({
        runtimeId: 'session-1',
        botName: 'Sniptail',
        model: 'claude-sonnet',
        modelProvider: 'anthropic',
        opencode: expect.objectContaining({ agent: 'build', executionMode: 'local' }) as unknown,
      }),
    );
    expect(hoisted.updateAgentSessionCodingAgentSessionId).toHaveBeenCalledWith(
      'session-1',
      'opencode-session-1',
    );
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'active');
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'completed');
    expect(notifier.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'final answer',
    );
  });

  it('flushes completed assistant text before the final response', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'assistant progress text',
    );
    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'final answer',
    );
  });

  it('keeps tool summaries out of Discord output', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onEvent?.({
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'opencode-session-1',
              messageID: 'message-1',
              type: 'tool',
              callID: 'call-1',
              tool: 'bash',
              state: {
                status: 'running',
                input: { command: 'pnpm test' },
                time: { start: 1 },
              },
            },
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenCalledTimes(2);
    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'final answer',
    );
  });

  it('records and clears the active OpenCode runtime ref', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    let activeRefDuringRun: ReturnType<typeof getActiveOpenCodeRuntime>;
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onSessionId?.('opencode-session-1');
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        activeRefDuringRun = getActiveOpenCodeRuntime('session-1');
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(activeRefDuringRun!).toEqual({
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: tempRoot,
      executionMode: 'local',
    });
    expect(getActiveOpenCodeRuntime('session-1')).toBeUndefined();
  });

  it('flushes pending assistant text before failure messages', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onEvent?.({
          type: 'session.error',
          properties: { error: { message: 'failed' } },
        });
        await options.onAssistantMessageCompleted?.(
          'assistant text before failure',
          buildAssistantCompletedEvent(),
        );
        throw new Error('prompt failed');
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'assistant text before failure',
    );
    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'OpenCode agent session failed: prompt failed',
    );
  });

  it('does not overwrite stopped sessions after OpenCode aborts', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.loadAgentSession.mockResolvedValueOnce({ status: 'stopped' });
    hoisted.runOpenCodePrompt.mockRejectedValueOnce(new Error('OpenCode prompt aborted'));

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(hoisted.updateAgentSessionStatus).not.toHaveBeenCalledWith('session-1', 'failed');
    expect(notifier.postMessage).toHaveBeenCalledTimes(1);
  });

  it('marks the session failed and reports errors when workspace resolution fails', async () => {
    const notifier = buildNotifier();

    await runAgentSessionStart({
      event: buildEvent({ cwd: 'missing' }),
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).not.toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'failed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      expect.stringContaining('OpenCode agent session failed:'),
    );
  });

  it('does not run OpenCode when agent sessions are disabled', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.enabled = false;

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).not.toHaveBeenCalled();
    expect(notifier.postMessage).not.toHaveBeenCalled();
  });
});
