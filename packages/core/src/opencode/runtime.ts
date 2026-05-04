import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk/v2';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import os from 'node:os';
import { toEnvRecord } from '../agents/envRecord.js';
import { resolveWorkerAgentScriptPath } from '../agents/resolveWorkerAgentScriptPath.js';
import type { AgentRunOptions } from '../agents/types.js';

export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export type OpenCodeRuntime = {
  client: OpenCodeClient;
  baseUrl: string;
  close(): Promise<void> | void;
};

export type OpenCodeRuntimeReady = {
  baseUrl: string;
  sessionId: string;
  directory: string;
  executionMode: 'local' | 'server' | 'docker';
};

export type OpenCodeAbortOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
};

export type OpenCodePermissionReply = 'once' | 'always' | 'reject';

export type OpenCodePermissionReplyOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
  requestID: string;
  workspace?: string;
  reply: OpenCodePermissionReply;
  message?: string;
};

export type OpenCodeQuestionReplyOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
  requestID: string;
  workspace?: string;
  answers: string[][];
};

export type OpenCodeQuestionRejectOptions = Pick<AgentRunOptions, 'opencode'> & {
  baseUrl?: string;
  requestID: string;
  workspace?: string;
};

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate OpenCode server port')));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function buildHeaders(env: NodeJS.ProcessEnv, options: AgentRunOptions): Record<string, string> {
  const headerEnv = options.opencode?.serverAuthHeaderEnv;
  if (!headerEnv) return {};
  const authHeader = env[headerEnv]?.trim();
  return authHeader ? { Authorization: authHeader } : {};
}

export async function createLocalRuntime(
  workDir: string,
  options: AgentRunOptions,
): Promise<OpenCodeRuntime> {
  const port = await getFreePort();
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port,
    timeout: options.opencode?.startupTimeoutMs ?? 10_000,
  });
  return {
    baseUrl: server.url,
    client: createOpencodeClient({ baseUrl: server.url, directory: workDir }),
    close: () => server.close(),
  };
}

function spawnDockerServer(
  runtimeId: string,
  workDir: string,
  port: number,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
): ChildProcess {
  const opencodeEnv = toEnvRecord(env);
  const docker = options.opencode?.docker;
  if (docker?.dockerfilePath) {
    opencodeEnv.OPENCODE_DOCKERFILE_PATH = resolve(docker.dockerfilePath);
  }
  if (docker?.image) {
    opencodeEnv.OPENCODE_DOCKER_IMAGE = docker.image;
  }
  if (docker?.buildContext) {
    opencodeEnv.OPENCODE_DOCKER_BUILD_CONTEXT = resolve(docker.buildContext);
  }
  const sanitizedJobId = runtimeId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  opencodeEnv.OPENCODE_DOCKER_CONTAINER_NAME =
    opencodeEnv.OPENCODE_DOCKER_CONTAINER_NAME ||
    `snatch-opencode-${sanitizedJobId}-${process.pid}-${Date.now()}`;
  opencodeEnv.OPENCODE_DOCKER_HOST_PORT = String(port);
  opencodeEnv.OPENCODE_DOCKER_WORKDIR = workDir;
  opencodeEnv.OPENCODE_DOCKER_WORKDIR_MODE =
    options.sandboxMode === 'read-only' ? 'readonly' : 'writable';
  opencodeEnv.OPENCODE_DOCKER_ADDITIONAL_DIRS = (options.additionalDirectories ?? []).join('\n');
  opencodeEnv.OPENCODE_DOCKER_HOST_HOME = opencodeEnv.OPENCODE_DOCKER_HOST_HOME || os.homedir();

  return spawn(resolveWorkerAgentScriptPath('opencode-docker-server.sh'), [], {
    env: opencodeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForServer(
  client: OpenCodeClient,
  workDir: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await client.config.get({ directory: workDir });
      if (!response.error) return;
      lastError = response.error;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for OpenCode server: ${String(lastError)}`);
}

export async function createDockerRuntime(
  runtimeId: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
): Promise<OpenCodeRuntime> {
  const port = await getFreePort();
  const proc = spawnDockerServer(runtimeId, workDir, port, env, options);
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = createOpencodeClient({ baseUrl, directory: workDir });
  let exited = false;
  let output = '';

  proc.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    output += text;
    if (options.opencode?.dockerStreamLogs) {
      process.stdout.write(text);
    }
  });
  proc.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    output += text;
    if (options.opencode?.dockerStreamLogs) {
      process.stderr.write(text);
    }
  });
  proc.once('exit', (code) => {
    exited = true;
    if (code !== 0) {
      output += `\nOpenCode docker server exited with code ${code}`;
    }
  });

  await waitForServer(client, workDir, options.opencode?.startupTimeoutMs ?? 10_000).catch(
    (err) => {
      proc.kill('SIGTERM');
      throw new Error(`${(err as Error).message}\n${output.trim()}`);
    },
  );

  return {
    baseUrl,
    client,
    close: () => {
      if (!exited) {
        proc.kill('SIGTERM');
      }
    },
  };
}

export function createServerRuntime(
  workDir: string,
  env: NodeJS.ProcessEnv,
  options: AgentRunOptions,
): OpenCodeRuntime {
  const baseUrl = options.opencode?.serverUrl;
  if (!baseUrl) {
    throw new Error('[opencode].server_url is required when execution_mode="server".');
  }
  const client = createOpencodeClient({
    baseUrl,
    directory: workDir,
    headers: buildHeaders(env, options),
  });
  return { baseUrl, client, close: () => undefined };
}
