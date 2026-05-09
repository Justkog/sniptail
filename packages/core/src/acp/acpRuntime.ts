import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type AgentCapabilities,
  type Client,
  type ClientCapabilities,
  type Implementation,
  type InitializeResponse,
  type LoadSessionResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import type { AcpLaunchConfig } from '../config/types.js';

const CLOSE_TIMEOUT_MS = 5_000;

export type AcpSessionStartOptions = {
  cwd: string;
  additionalDirectories?: string[];
};

export type AcpPromptOptions = {
  prompt: string;
};

export type AcpRuntimeOptions = {
  launch: AcpLaunchConfig;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  clientInfo?: Implementation;
  clientCapabilities?: ClientCapabilities;
  onSessionUpdate?: (notification: SessionNotification) => void | Promise<void>;
};

export type AcpRuntimeHandle = {
  connection: ClientSideConnection;
  capabilities: AgentCapabilities;
  agentInfo?: Implementation;
  sessionId?: string;
  createSession(options?: AcpSessionStartOptions): Promise<NewSessionResponse>;
  loadSession(sessionId: string, options?: AcpSessionStartOptions): Promise<LoadSessionResponse>;
  prompt(options: AcpPromptOptions): Promise<PromptResponse>;
  cancel(): Promise<void>;
  close(): Promise<void>;
};

type AcpSessionResponse = NewSessionResponse | LoadSessionResponse;

async function initializeAcpConnection(
  connection: ClientSideConnection,
  params: Parameters<ClientSideConnection['initialize']>[0],
): Promise<InitializeResponse> {
  return (await connection.initialize(params)) as unknown as InitializeResponse;
}

async function createAcpSession(
  connection: ClientSideConnection,
  params: Parameters<ClientSideConnection['newSession']>[0],
): Promise<NewSessionResponse> {
  return (await connection.newSession(params)) as unknown as NewSessionResponse;
}

async function loadAcpSession(
  connection: ClientSideConnection,
  params: Parameters<ClientSideConnection['loadSession']>[0],
): Promise<LoadSessionResponse> {
  return (await connection.loadSession(params)) as unknown as LoadSessionResponse;
}

async function promptAcpSession(
  connection: ClientSideConnection,
  params: Parameters<ClientSideConnection['prompt']>[0],
): Promise<PromptResponse> {
  return (await connection.prompt(params)) as unknown as PromptResponse;
}

async function setAcpSessionConfigOption(
  connection: ClientSideConnection,
  params: SetSessionConfigOptionRequest,
): Promise<SetSessionConfigOptionResponse> {
  return (await connection.setSessionConfigOption(
    params,
  )) as unknown as SetSessionConfigOptionResponse;
}

function mergeEnv(
  baseEnv: NodeJS.ProcessEnv | undefined,
  launchEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...baseEnv,
    ...launchEnv,
  };
}

function formatOutput(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed ? `\n${trimmed}` : '';
}

function processExitError(
  command: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Error {
  if (signal) {
    return new Error(`ACP agent process exited before initialization: ${command} (${signal})`);
  }
  return new Error(
    `ACP agent process exited before initialization: ${command} (${code ?? 'unknown'})`,
  );
}

function waitForExit(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
  });
}

async function terminateProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  await Promise.race([
    waitForExit(proc),
    new Promise<void>((resolve) => {
      setTimeout(resolve, CLOSE_TIMEOUT_MS);
    }),
  ]);
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL');
    await waitForExit(proc);
  }
}

function normalizeMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function isSelectOption(
  option: SessionConfigOption,
): option is Extract<SessionConfigOption, { type: 'select' }> {
  return option.type === 'select';
}

function flattenSelectOptions(
  options: Extract<SessionConfigOption, { type: 'select' }>['options'],
): SessionConfigSelectOption[] {
  return options.flatMap((option): SessionConfigSelectOption[] =>
    'group' in option ? option.options : [option],
  );
}

function findSelectOption(
  configOptions: SessionConfigOption[] | undefined,
  matchesConfig: (option: Extract<SessionConfigOption, { type: 'select' }>) => boolean,
  requestedValue: string,
): {
  config: Extract<SessionConfigOption, { type: 'select' }>;
  value: string;
} {
  const requested = normalizeMatch(requestedValue);
  for (const config of configOptions ?? []) {
    if (!isSelectOption(config) || !matchesConfig(config)) continue;
    const selected = flattenSelectOptions(config.options).find(
      (option) =>
        normalizeMatch(option.value) === requested || normalizeMatch(option.name) === requested,
    );
    if (selected) {
      return { config, value: selected.value };
    }
  }
  throw new Error(`ACP session config option is not supported by this agent: ${requestedValue}`);
}

function optionName(option: SessionConfigOption): string {
  return normalizeMatch(`${option.id} ${option.name} ${option.category ?? ''}`);
}

function isProviderOption(option: SessionConfigOption): boolean {
  const name = optionName(option);
  return name.includes('provider');
}

function isReasoningOption(option: SessionConfigOption): boolean {
  const name = optionName(option);
  return (
    option.category === 'thought_level' ||
    name.includes('reasoning') ||
    name.includes('thought') ||
    name.includes('effort')
  );
}

async function applySessionOverrides(
  connection: ClientSideConnection,
  launch: AcpLaunchConfig,
  sessionId: string,
  session: AcpSessionResponse,
): Promise<void> {
  if (launch.profile) {
    const requested = normalizeMatch(launch.profile);
    const mode = session.modes?.availableModes.find(
      (candidate) =>
        normalizeMatch(candidate.id) === requested || normalizeMatch(candidate.name) === requested,
    );
    if (!mode) {
      throw new Error(`ACP profile is not supported by this agent: ${launch.profile}`);
    }
    await connection.setSessionMode({ sessionId, modeId: mode.id });
  }

  if (launch.model) {
    const requested = normalizeMatch(launch.model);
    const model = session.models?.availableModels.find(
      (candidate) =>
        normalizeMatch(candidate.modelId) === requested ||
        normalizeMatch(candidate.name) === requested,
    );
    if (!model) {
      throw new Error(`ACP model is not supported by this agent: ${launch.model}`);
    }
    await connection.unstable_setSessionModel({ sessionId, modelId: model.modelId });
  }

  let configOptions = session.configOptions ?? undefined;
  if (launch.modelProvider) {
    const selected = findSelectOption(configOptions, isProviderOption, launch.modelProvider);
    const response = await setAcpSessionConfigOption(connection, {
      sessionId,
      configId: selected.config.id,
      value: selected.value,
    });
    configOptions = response.configOptions;
  }

  if (launch.reasoningEffort) {
    const selected = findSelectOption(configOptions, isReasoningOption, launch.reasoningEffort);
    const response = await setAcpSessionConfigOption(connection, {
      sessionId,
      configId: selected.config.id,
      value: selected.value,
    });
    configOptions = response.configOptions;
  }
}

function buildClient(onSessionUpdate: AcpRuntimeOptions['onSessionUpdate']): Client {
  return {
    requestPermission: () =>
      Promise.resolve({
        outcome: { outcome: 'cancelled' },
      } satisfies RequestPermissionResponse),
    sessionUpdate: async (notification) => {
      await onSessionUpdate?.(notification as unknown as SessionNotification);
    },
  };
}

export async function launchAcpRuntime(options: AcpRuntimeOptions): Promise<AcpRuntimeHandle> {
  const [command, ...args] = options.launch.command;
  if (!command) {
    throw new Error('ACP command must contain at least one item.');
  }

  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: mergeEnv(options.env, options.launch.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  if (!proc.stdin || !proc.stdout) {
    await terminateProcess(proc);
    throw new Error('ACP agent process did not expose stdio streams.');
  }

  const startupFailure = new Promise<never>((_resolve, reject) => {
    proc.once('error', reject);
    proc.once('exit', (code, signal) => {
      reject(processExitError(command, code, signal));
    });
  });
  const stream = ndJsonStream(
    Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
  );
  const connection = new ClientSideConnection(() => buildClient(options.onSessionUpdate), stream);
  const initialize = initializeAcpConnection(connection, {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: options.clientInfo ?? { name: 'Sniptail' },
    clientCapabilities: options.clientCapabilities ?? {},
  });
  let initialized: InitializeResponse;
  try {
    initialized = await Promise.race([initialize, startupFailure]);
  } catch (err) {
    await terminateProcess(proc);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}${formatOutput(stderr)}`);
  }
  void startupFailure.catch(() => undefined);

  let sessionId: string | undefined;
  let closed = false;

  const startOptions = (sessionOptions?: AcpSessionStartOptions) => ({
    cwd: sessionOptions?.cwd ?? options.cwd,
    mcpServers: [],
    ...(sessionOptions?.additionalDirectories
      ? { additionalDirectories: sessionOptions.additionalDirectories }
      : {}),
  });

  const handle: AcpRuntimeHandle = {
    connection,
    capabilities: initialized.agentCapabilities ?? {},
    ...(initialized.agentInfo ? { agentInfo: initialized.agentInfo } : {}),
    async createSession(sessionOptions) {
      const session = await createAcpSession(connection, startOptions(sessionOptions));
      sessionId = session.sessionId;
      handle.sessionId = session.sessionId;
      await applySessionOverrides(connection, options.launch, session.sessionId, session);
      return session;
    },
    async loadSession(existingSessionId, sessionOptions) {
      if (!initialized.agentCapabilities?.loadSession) {
        throw new Error(
          `ACP agent does not support session/load; cannot load session ${existingSessionId}.`,
        );
      }
      const session = await loadAcpSession(connection, {
        ...startOptions(sessionOptions),
        sessionId: existingSessionId,
      });
      sessionId = existingSessionId;
      handle.sessionId = existingSessionId;
      await applySessionOverrides(connection, options.launch, existingSessionId, session);
      return session;
    },
    async prompt(promptOptions) {
      if (!sessionId) {
        throw new Error('ACP session has not been created or loaded.');
      }
      return await promptAcpSession(connection, {
        sessionId,
        prompt: [{ type: 'text', text: promptOptions.prompt }],
      });
    },
    async cancel() {
      if (!sessionId) return;
      await connection.cancel({ sessionId });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (sessionId && initialized.agentCapabilities?.sessionCapabilities?.close) {
        try {
          await connection.closeSession({ sessionId });
        } catch {
          // Process termination below is still the authoritative cleanup path.
        }
      }
      await terminateProcess(proc);
    },
  };
  return handle;
}
