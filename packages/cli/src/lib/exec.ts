import { spawn } from 'node:child_process';

type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  nodeArgs?: string[];
  args?: string[];
};

export function runNode(entry: string, options: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...(options.nodeArgs ?? []), entry, ...(options.args ?? [])],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: 'inherit',
      },
    );

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code ?? 'unknown'}`));
    });
  });
}
