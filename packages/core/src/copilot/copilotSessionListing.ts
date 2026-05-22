import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { CopilotClient, type SessionContext, type SessionListFilter } from '@github/copilot-sdk';
import { resolveWorkerAgentScriptPath } from '../agents/resolveWorkerAgentScriptPath.js';
import { toEnvRecord } from '../agents/envRecord.js';

export type ListedCopilotSession = {
  sessionId: string;
  startTime: Date;
  modifiedTime: Date;
  summary?: string;
  isRemote: boolean;
  context?: SessionContext;
};

export type ListCopilotSessionsInput = {
  workDir: string;
  env: NodeJS.ProcessEnv;
  executionMode: 'local' | 'docker';
  filter?: SessionListFilter;
  docker?: {
    dockerfilePath?: string;
    image?: string;
    buildContext?: string;
  };
};

const COPILOT_DOCKER_CONTAINER_NAME_ENV = 'GH_COPILOT_DOCKER_CONTAINER_NAME';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildContainerName(): string {
  return `sniptail-copilot-list-${process.pid}-${Date.now()}`;
}

function buildCopilotClientInput(input: ListCopilotSessionsInput): {
  env: Record<string, string>;
  cliPath?: string;
  containerName?: string;
} {
  const copilotEnv = toEnvRecord(input.env);
  if (input.executionMode !== 'docker') {
    return {
      env: copilotEnv,
    };
  }

  if (input.docker?.dockerfilePath) {
    copilotEnv.GH_COPILOT_DOCKERFILE_PATH = resolve(input.docker.dockerfilePath);
  }
  if (input.docker?.image) {
    copilotEnv.GH_COPILOT_DOCKER_IMAGE = input.docker.image;
  }
  if (input.docker?.buildContext) {
    copilotEnv.GH_COPILOT_DOCKER_BUILD_CONTEXT = resolve(input.docker.buildContext);
  }

  const containerName =
    copilotEnv[COPILOT_DOCKER_CONTAINER_NAME_ENV] || buildContainerName();
  copilotEnv[COPILOT_DOCKER_CONTAINER_NAME_ENV] = containerName;

  return {
    env: copilotEnv,
    cliPath: resolveWorkerAgentScriptPath('copilot-docker.sh'),
    containerName,
  };
}

async function stopDockerContainer(containerName: string | undefined): Promise<void> {
  if (!containerName) {
    return;
  }

  await new Promise<void>((resolvePromise) => {
    execFile('docker', ['stop', containerName], () => resolvePromise());
  });
  await new Promise<void>((resolvePromise) => {
    execFile('docker', ['rm', '-f', containerName], () => resolvePromise());
  });
}

async function stopCopilotClient(
  client: CopilotClient,
  executionMode: ListCopilotSessionsInput['executionMode'],
  containerName: string | undefined,
  options?: {
    forceStop?: boolean;
  },
): Promise<void> {
  const stopTimeoutMs = 5_000;
  const stopErrors = await Promise.race([
    client.stop().catch((err) => [err instanceof Error ? err : new Error(String(err))]),
    new Promise<Error[]>((resolvePromise) => {
      setTimeout(() => resolvePromise([new Error('Copilot stop timeout')]), stopTimeoutMs);
    }),
  ]);

  if (stopErrors.length > 0 || options?.forceStop) {
    try {
      await client.forceStop();
    } catch {
      // Ignore force-stop failures during cleanup.
    }
  }

  if (executionMode === 'docker') {
    await stopDockerContainer(containerName);
  }
}

export async function listCopilotSessions(
  input: ListCopilotSessionsInput,
): Promise<ListedCopilotSession[]> {
  const clientInput = buildCopilotClientInput(input);
  const client = new CopilotClient({
    cwd: input.workDir,
    env: clientInput.env,
    autoRestart: false,
    ...(clientInput.cliPath ? { cliPath: clientInput.cliPath } : {}),
  });

  let started = false;
  try {
    await client.start();
    started = true;
    return (await client.listSessions(input.filter)) as ListedCopilotSession[];
  } catch (err) {
    throw new Error(`Copilot session list failed: ${toErrorMessage(err)}`);
  } finally {
    if (started || input.executionMode === 'docker') {
      await stopCopilotClient(client, input.executionMode, clientInput.containerName, {
        forceStop: !started && input.executionMode === 'docker',
      });
    }
  }
}
