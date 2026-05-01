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
  updateAgentSessionCodingAgentSessionId: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}));

vi.mock('@sniptail/core/opencode/opencode.js', () => ({
  runOpenCodePrompt: hoisted.runOpenCodePrompt,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  updateAgentSessionCodingAgentSessionId: hoisted.updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

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
        await options.onEvent?.({
          type: 'message.updated',
          properties: { info: { role: 'assistant', time: { completed: Date.now() } } },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.updateAgentSessionCodingAgentSessionId.mockResolvedValue(undefined);
  });

  afterEach(async () => {
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
