import { spawn } from 'node:child_process';
import { isSea } from 'node:sea';

type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  nodeArgs?: string[];
  args?: string[];
};

export function runNode(entry: string, options: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
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
