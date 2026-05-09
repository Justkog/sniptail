import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, SessionNotification } from '@agentclientprotocol/sdk';
import { launchAcpRuntime } from './acpRuntime.js';

type MockChildProcess = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
};

type MockAcpMethod = (params: unknown) => Promise<unknown>;

type MockConnection = {
  initialize: ReturnType<typeof vi.fn<MockAcpMethod>>;
  newSession: ReturnType<typeof vi.fn<MockAcpMethod>>;
  loadSession: ReturnType<typeof vi.fn<MockAcpMethod>>;
  prompt: ReturnType<typeof vi.fn<MockAcpMethod>>;
  cancel: ReturnType<typeof vi.fn<MockAcpMethod>>;
  closeSession: ReturnType<typeof vi.fn<MockAcpMethod>>;
  setSessionMode: ReturnType<typeof vi.fn<MockAcpMethod>>;
  unstable_setSessionModel: ReturnType<typeof vi.fn<MockAcpMethod>>;
  setSessionConfigOption: ReturnType<typeof vi.fn<MockAcpMethod>>;
};

const hoisted = vi.hoisted(() => ({
  spawn: vi.fn(),
  ndJsonStream: vi.fn(() => ({ readable: {}, writable: {} })),
  lastClient: undefined as Client | undefined,
  lastStream: undefined as unknown,
  connections: [] as MockConnection[],
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    spawn: hoisted.spawn,
  };
});

vi.mock('@agentclientprotocol/sdk', () => {
  class ClientSideConnectionMock {
    private connection: MockConnection;

    constructor(toClient: () => Client, stream: unknown) {
      hoisted.lastClient = toClient();
      hoisted.lastStream = stream;
      this.connection = hoisted.connections.at(-1) as MockConnection;
    }

    initialize(params: unknown) {
      return this.connection.initialize(params);
    }

    newSession(params: unknown) {
      return this.connection.newSession(params);
    }

    loadSession(params: unknown) {
      return this.connection.loadSession(params);
    }

    prompt(params: unknown) {
      return this.connection.prompt(params);
    }

    cancel(params: unknown) {
      return this.connection.cancel(params);
    }

    closeSession(params: unknown) {
      return this.connection.closeSession(params);
    }

    setSessionMode(params: unknown) {
      return this.connection.setSessionMode(params);
    }

    unstable_setSessionModel(params: unknown) {
      return this.connection.unstable_setSessionModel(params);
    }

    setSessionConfigOption(params: unknown) {
      return this.connection.setSessionConfigOption(params);
    }
  }

  return {
    ClientSideConnection: ClientSideConnectionMock,
    PROTOCOL_VERSION: 1,
    ndJsonStream: hoisted.ndJsonStream,
  };
});

function buildProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = vi.fn((signal: NodeJS.Signals) => {
    proc.signalCode = signal;
    proc.emit('exit', null, signal);
    return true;
  });
  return proc;
}

function buildConnection(): MockConnection {
  return {
    initialize: vi.fn<MockAcpMethod>().mockResolvedValue({
      protocolVersion: 1,
      agentInfo: { name: 'Mock ACP' },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { close: {} },
      },
    }),
    newSession: vi.fn<MockAcpMethod>().mockResolvedValue({ sessionId: 'session-1' }),
    loadSession: vi.fn<MockAcpMethod>().mockResolvedValue({ sessionId: 'session-loaded' }),
    prompt: vi.fn<MockAcpMethod>().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn<MockAcpMethod>().mockResolvedValue(undefined),
    closeSession: vi.fn<MockAcpMethod>().mockResolvedValue({}),
    setSessionMode: vi.fn<MockAcpMethod>().mockResolvedValue({}),
    unstable_setSessionModel: vi.fn<MockAcpMethod>().mockResolvedValue({}),
    setSessionConfigOption: vi.fn<MockAcpMethod>().mockResolvedValue({ configOptions: [] }),
  };
}

function queueRuntime(proc = buildProcess(), connection = buildConnection()) {
  hoisted.spawn.mockReturnValue(proc);
  hoisted.connections.push(connection);
  return { proc, connection };
}

describe('ACP runtime wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.connections = [];
    hoisted.lastClient = undefined;
    hoisted.lastStream = undefined;
  });

  it('spawns the configured stdio command and initializes the ACP connection', async () => {
    const { connection } = queueRuntime();

    const runtime = await launchAcpRuntime({
      cwd: '/tmp/work',
      env: { TOKEN: 'base', SHARED: 'base' },
      launch: {
        command: ['mock-acp', '--stdio'],
        env: { SHARED: 'override', EXTRA: 'yes' },
      },
      clientInfo: { name: 'Sniptail Test', version: '1.0.0' },
      clientCapabilities: { fs: { readTextFile: true } },
    });

    expect(hoisted.spawn).toHaveBeenCalledWith(
      'mock-acp',
      ['--stdio'],
      expect.objectContaining({
        cwd: '/tmp/work',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({
          TOKEN: 'base',
          SHARED: 'override',
          EXTRA: 'yes',
        }) as unknown,
      }),
    );
    expect(hoisted.ndJsonStream).toHaveBeenCalledTimes(1);
    expect(connection.initialize).toHaveBeenCalledWith({
      protocolVersion: 1,
      clientInfo: { name: 'Sniptail Test', version: '1.0.0' },
      clientCapabilities: { fs: { readTextFile: true } },
    });
    expect(runtime.capabilities).toEqual({
      loadSession: true,
      sessionCapabilities: { close: {} },
    });
    expect(runtime.agentInfo).toEqual({ name: 'Mock ACP' });
  });

  it('creates a session, applies configured overrides, sends a text prompt, and closes cleanly', async () => {
    const configOptions = [
      {
        id: 'provider',
        name: 'Provider',
        type: 'select',
        category: 'model_provider',
        currentValue: 'openai',
        options: [
          { value: 'openai', name: 'OpenAI' },
          { value: 'anthropic', name: 'Anthropic' },
        ],
      },
      {
        id: 'thought-level',
        name: 'Thought Level',
        type: 'select',
        category: 'thought_level',
        currentValue: 'medium',
        options: [
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      },
    ];
    const { proc, connection } = queueRuntime();
    connection.newSession.mockResolvedValue({
      sessionId: 'session-1',
      modes: {
        currentModeId: 'ask',
        availableModes: [
          { id: 'ask', name: 'Ask' },
          { id: 'build', name: 'Build' },
        ],
      },
      models: {
        currentModelId: 'gpt-5.5',
        availableModels: [
          { modelId: 'gpt-5.5', name: 'GPT-5.5' },
          { modelId: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
        ],
      },
      configOptions,
    });
    connection.setSessionConfigOption
      .mockResolvedValueOnce({ configOptions })
      .mockResolvedValueOnce({ configOptions });

    const runtime = await launchAcpRuntime({
      cwd: '/tmp/work',
      launch: {
        command: ['mock-acp'],
        profile: 'build',
        model: 'Claude Sonnet 4.5',
        modelProvider: 'Anthropic',
        reasoningEffort: 'high',
      },
    });

    const session = await runtime.createSession({
      cwd: '/tmp/project',
      additionalDirectories: ['/tmp/repo-cache'],
    });
    await runtime.prompt({ prompt: 'Please inspect the repo.' });
    await runtime.cancel();
    await runtime.close();
    await runtime.close();

    expect(session.sessionId).toBe('session-1');
    expect(runtime.sessionId).toBe('session-1');
    expect(connection.newSession).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      mcpServers: [],
      additionalDirectories: ['/tmp/repo-cache'],
    });
    expect(connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: 'session-1',
      modeId: 'build',
    });
    expect(connection.unstable_setSessionModel).toHaveBeenCalledWith({
      sessionId: 'session-1',
      modelId: 'claude-sonnet-4.5',
    });
    expect(connection.setSessionConfigOption).toHaveBeenNthCalledWith(1, {
      sessionId: 'session-1',
      configId: 'provider',
      value: 'anthropic',
    });
    expect(connection.setSessionConfigOption).toHaveBeenNthCalledWith(2, {
      sessionId: 'session-1',
      configId: 'thought-level',
      value: 'high',
    });
    expect(connection.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'Please inspect the repo.' }],
    });
    expect(connection.cancel).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(connection.closeSession).toHaveBeenCalledTimes(1);
    expect(connection.closeSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('loads an existing session only when the agent advertises session/load', async () => {
    const { connection } = queueRuntime();

    const runtime = await launchAcpRuntime({
      cwd: '/tmp/work',
      launch: { command: ['mock-acp'] },
    });
    await runtime.loadSession('existing-session', {
      cwd: '/tmp/work',
      additionalDirectories: ['/tmp/repo-cache'],
    });

    expect(runtime.sessionId).toBe('existing-session');
    expect(connection.loadSession).toHaveBeenCalledWith({
      sessionId: 'existing-session',
      cwd: '/tmp/work',
      mcpServers: [],
      additionalDirectories: ['/tmp/repo-cache'],
    });
  });

  it('throws when loading a session without session/load capability', async () => {
    const { connection } = queueRuntime();
    connection.initialize.mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: {},
    });

    const runtime = await launchAcpRuntime({
      cwd: '/tmp/work',
      launch: { command: ['mock-acp'] },
    });

    await expect(runtime.loadSession('existing-session')).rejects.toThrow(
      'ACP agent does not support session/load',
    );
    expect(connection.loadSession).not.toHaveBeenCalled();
  });

  it('forwards raw session updates from the ACP client handler', async () => {
    queueRuntime();
    const onSessionUpdate = vi.fn();
    await launchAcpRuntime({
      cwd: '/tmp/work',
      launch: { command: ['mock-acp'] },
      onSessionUpdate,
    });
    const notification: SessionNotification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    };

    await hoisted.lastClient?.sessionUpdate(notification);

    expect(onSessionUpdate).toHaveBeenCalledWith(notification);
  });

  it('fails configured overrides when the launched ACP agent cannot support them', async () => {
    const { connection } = queueRuntime();
    connection.newSession.mockResolvedValue({
      sessionId: 'session-1',
      modes: {
        currentModeId: 'ask',
        availableModes: [{ id: 'ask', name: 'Ask' }],
      },
    });

    const runtime = await launchAcpRuntime({
      cwd: '/tmp/work',
      launch: {
        command: ['mock-acp'],
        profile: 'build',
      },
    });

    await expect(runtime.createSession()).rejects.toThrow(
      'ACP profile is not supported by this agent: build',
    );
  });

  it('includes early process stderr when initialization fails', async () => {
    const proc = buildProcess();
    const { connection } = queueRuntime(proc);
    connection.initialize.mockImplementation(
      () =>
        new Promise(() => {
          // Keep initialize pending so the process exit wins the startup race.
        }),
    );

    const promise = launchAcpRuntime({
      cwd: '/tmp/work',
      launch: { command: ['mock-acp'] },
    });
    proc.stderr.emit('data', 'bad startup\n');
    proc.exitCode = 2;
    proc.emit('exit', 2, null);

    await expect(promise).rejects.toThrow('bad startup');
  });
});
