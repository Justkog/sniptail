import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logFilePath?: string;
  echo?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  redact?: Array<string | RegExp>;
  allowFailure?: boolean;
};

export type RunResult = {
  cmd: string;
  args: string[];
  cwd?: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
};

export class CommandError extends Error {
  readonly result: RunResult;

  constructor(message: string, result: RunResult) {
    super(message);
    this.name = 'CommandError';
    this.result = result;
  }
}

function redactText(text: string, patterns: Array<string | RegExp>): string {
  if (!text) return text;
  let out = text;
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      if (!pattern) continue;
      out = out.split(pattern).join('[REDACTED]');
    } else {
      out = out.replace(pattern, '[REDACTED]');
    }
  }
  return out;
}

function ensureLogPath(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

export async function runCommand(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const start = Date.now();
  const {
    cwd,
    env,
    echo = false,
    logFilePath,
    timeoutMs = 0,
    signal,
    redact = [],
    allowFailure = false,
  } = opts;

  const redactionPatterns: Array<string | RegExp> = [
    /glpat-[A-Za-z0-9_-]{10,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    ...redact,
  ];

  let logStream: ReturnType<typeof createWriteStream> | undefined;
  if (logFilePath) {
    ensureLogPath(logFilePath);
    logStream = createWriteStream(logFilePath, { flags: 'a' });
    logStream.write(`\n\n---\n$ ${cmd} ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`);
  }

  let timedOut = false;
  let aborted = false;

  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const onAbort = () => {
    aborted = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // best effort
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort
      }
    }, 2000).unref();
  };

  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let timeout: NodeJS.Timeout | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // best effort
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // best effort
        }
      }, 2000).unref();
    }, timeoutMs);
    timeout.unref();
  }

  let stdoutBuf = '';
  let stderrBuf = '';

  const handleChunk = (chunk: Buffer, isErr: boolean) => {
    const raw = chunk.toString('utf8');
    const redacted = redactText(raw, redactionPatterns);

    if (isErr) stderrBuf += redacted;
    else stdoutBuf += redacted;

    if (logStream) logStream.write(redacted);
    if (echo) {
      if (isErr) process.stderr.write(redacted);
      else process.stdout.write(redacted);
    }
  };

  child.stdout?.on('data', (chunk: Buffer<ArrayBufferLike>) => handleChunk(chunk, false));
  child.stderr?.on('data', (chunk: Buffer<ArrayBufferLike>) => handleChunk(chunk, true));

  const resultBase = await new Promise<RunResult>((resolve, reject) => {
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      if (logStream) logStream.end();
      reject(err);
    });

    child.on('close', (exitCode, sig) => {
      if (timeout) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (logStream) logStream.end();

      const base: RunResult = {
        cmd,
        args,
        durationMs: Date.now() - start,
        exitCode,
        signal: sig,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        timedOut,
        aborted,
      };
      if (cwd) base.cwd = cwd;
      resolve(base);
    });
  });

  const result = resultBase;

  if (!allowFailure && (result.exitCode ?? 1) !== 0) {
    const msg =
      `Command failed (${result.exitCode ?? 'null'}): ${cmd} ${args.join(' ')}\n` +
      `cwd=${cwd ?? process.cwd()}\n` +
      (result.timedOut ? 'Reason: timed out\n' : '') +
      (result.aborted ? 'Reason: aborted\n' : '');
    throw new CommandError(msg, result);
  }

  return result;
}
