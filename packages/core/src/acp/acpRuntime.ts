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
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { AcpLaunchConfig } from '../config/types.js';
import type {
  AcpCreateElicitationRequest,
  AcpCreateElicitationResponse,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from './types.js';

const CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_CLIENT_INFO: Implementation = {
  name: 'Sniptail',
  version: '0.1.0',
};
const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  elicitation: {
    form: {},
  },
};

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
  diagnostics?: {
    configSource?: string;
  };
  clientInfo?: Implementation;
  clientCapabilities?: ClientCapabilities;
  onSessionUpdate?: (notification: SessionNotification) => void | Promise<void>;
  onRequestPermission?: (
    request: AcpRequestPermissionRequest,
  ) => AcpRequestPermissionResponse | Promise<AcpRequestPermissionResponse>;
  onCreateElicitation?: (
    request: AcpCreateElicitationRequest,
  ) => AcpCreateElicitationResponse | Promise<AcpCreateElicitationResponse>;
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

function buildRuntimeContext(options: AcpRuntimeOptions, agentInfo?: Implementation): string {
  const parts = [
    options.diagnostics?.configSource,
    `command: ${basename(options.launch.command[0] ?? 'unknown')}`,
    options.launch.agent ? `configured agent: ${options.launch.agent}` : undefined,
    agentInfo?.name ? `ACP agent: ${agentInfo.name}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.join(', ');
}

function wrapRuntimeError(
  options: AcpRuntimeOptions,
  err: unknown,
  agentInfo?: Implementation,
): Error {
  const message = err instanceof Error ? err.message : String(err);
  const context = buildRuntimeContext(options, agentInfo);
  return new Error(context ? `ACP runtime failed (${context}): ${message}` : message);
}

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

function mergeClientCapabilities(
  clientCapabilities: ClientCapabilities | undefined,
): ClientCapabilities {
  return {
    ...DEFAULT_CLIENT_CAPABILITIES,
    ...clientCapabilities,
    elicitation: {
      ...DEFAULT_CLIENT_CAPABILITIES.elicitation,
      ...clientCapabilities?.elicitation,
    },
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

function buildClient(
  options: Pick<
    AcpRuntimeOptions,
    'onSessionUpdate' | 'onRequestPermission' | 'onCreateElicitation'
  >,
): Client {
  return {
    requestPermission: async (request) =>
      (await options.onRequestPermission?.(request as unknown as AcpRequestPermissionRequest)) ?? {
        outcome: { outcome: 'cancelled' },
      },
    unstable_createElicitation: async (request) =>
      (await options.onCreateElicitation?.(request as unknown as AcpCreateElicitationRequest)) ?? {
        action: 'cancel',
      },
    sessionUpdate: async (notification) => {
      await options.onSessionUpdate?.(notification as unknown as SessionNotification);
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
  const connection = new ClientSideConnection(
    () =>
      buildClient({
        ...(options.onSessionUpdate ? { onSessionUpdate: options.onSessionUpdate } : {}),
        ...(options.onRequestPermission
          ? { onRequestPermission: options.onRequestPermission }
          : {}),
        ...(options.onCreateElicitation
          ? { onCreateElicitation: options.onCreateElicitation }
          : {}),
      }),
    stream,
  );
  const initialize = initializeAcpConnection(connection, {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: options.clientInfo ?? DEFAULT_CLIENT_INFO,
    clientCapabilities: mergeClientCapabilities(options.clientCapabilities),
  });
  let initialized: InitializeResponse;
  try {
    initialized = await Promise.race([initialize, startupFailure]);
  } catch (err) {
    await terminateProcess(proc);
    const message = err instanceof Error ? err.message : String(err);
    throw wrapRuntimeError(options, `${message}${formatOutput(stderr)}`);
  }
  void startupFailure.catch(() => undefined);

  let sessionId: string | undefined;
  let closed = false;
  const runtimeAgentInfo = initialized.agentInfo ?? undefined;

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
    ...(runtimeAgentInfo ? { agentInfo: runtimeAgentInfo } : {}),
    async createSession(sessionOptions) {
      let session: NewSessionResponse;
      try {
        session = await createAcpSession(connection, startOptions(sessionOptions));
      } catch (err) {
        throw wrapRuntimeError(options, err, runtimeAgentInfo);
      }
      sessionId = session.sessionId;
      handle.sessionId = session.sessionId;
      try {
        await applySessionOverrides(connection, options.launch, session.sessionId, session);
      } catch (err) {
        throw wrapRuntimeError(options, err, runtimeAgentInfo);
      }
      return session;
    },
    async loadSession(existingSessionId, sessionOptions) {
      if (!initialized.agentCapabilities?.loadSession) {
        throw wrapRuntimeError(
          options,
          `ACP agent does not support session/load; cannot load session ${existingSessionId}.`,
          runtimeAgentInfo,
        );
      }
      let session: LoadSessionResponse;
      try {
        session = await loadAcpSession(connection, {
          ...startOptions(sessionOptions),
          sessionId: existingSessionId,
        });
      } catch (err) {
        throw wrapRuntimeError(options, err, runtimeAgentInfo);
      }
      sessionId = existingSessionId;
      handle.sessionId = existingSessionId;
      try {
        await applySessionOverrides(connection, options.launch, existingSessionId, session);
      } catch (err) {
        throw wrapRuntimeError(options, err, runtimeAgentInfo);
      }
      return session;
    },
    async prompt(promptOptions) {
      if (!sessionId) {
        throw new Error('ACP session has not been created or loaded.');
      }
      try {
        return await promptAcpSession(connection, {
          sessionId,
          prompt: [{ type: 'text', text: promptOptions.prompt }],
        });
      } catch (err) {
        throw wrapRuntimeError(options, err, runtimeAgentInfo);
      }
    },
    async cancel() {
      if (!sessionId) return;
      try {
        await connection.cancel({ sessionId });
      } catch (err) {
        throw wrapRuntimeError(options, err, runtimeAgentInfo);
      }
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
