import { spawn } from 'node:child_process';
import { isSea } from 'node:sea';

type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  nodeArgs?: string[];
  args?: string[];
};

export type RunNodeCaptureResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals;
};

function buildChildProcessInvocation(
  entry: string,
  options: RunOptions,
): { childArgs: string[]; childEnv: NodeJS.ProcessEnv } {
  const runningInSea = isSea();
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  const childArgs = runningInSea
    ? []
    : [...(options.nodeArgs ?? []), entry, ...(options.args ?? [])];

  if (runningInSea) {
    childEnv.SNIPTAIL_INTERNAL_ENTRY = entry;
    childEnv.SNIPTAIL_INTERNAL_NODE_ARGS = JSON.stringify(options.nodeArgs ?? []);
    childEnv.SNIPTAIL_INTERNAL_ARGS = JSON.stringify(options.args ?? []);
  }

  return { childArgs, childEnv };
}

export function runNode(entry: string, options: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const { childArgs, childEnv } = buildChildProcessInvocation(entry, options);

    const child = spawn(process.execPath, childArgs, {
      cwd: options.cwd,
      env: childEnv,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code ?? 'unknown'}`));
    });
  });
}

export function runNodeCapture(entry: string, options: RunOptions): Promise<RunNodeCaptureResult> {
  return new Promise((resolve, reject) => {
    const { childArgs, childEnv } = buildChildProcessInvocation(entry, options);

    const child = spawn(process.execPath, childArgs, {
      cwd: options.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        ...(signal ? { signal } : {}),
      });
    });
  });
}
