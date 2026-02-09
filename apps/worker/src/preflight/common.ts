import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type ExecFileLike = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export const execFileAsync = promisify(execFile);

export function stringifyError(err: unknown): string {
  if (err && typeof err === 'object') {
    const withStderr = err as { stderr?: unknown; message?: unknown };
    if (typeof withStderr.stderr === 'string' && withStderr.stderr.trim()) {
      return withStderr.stderr.trim();
    }
    if (typeof withStderr.message === 'string' && withStderr.message.trim()) {
      return withStderr.message.trim();
    }
  }
  return String(err);
}
