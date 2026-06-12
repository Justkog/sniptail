import 'dotenv/config';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { runWorkerDoctorPreflightChecks } from './doctorPreflightChecks.js';

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runWithJsonStdout<T>(run: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalWrite = process.stdout.write;
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: unknown,
    callback?: unknown,
  ) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (text) process.stderr.write(text);
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write;

  try {
    return await run();
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const report = await runWithJsonStdout(() => runWorkerDoctorPreflightChecks(config));
  writeJson(report);
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
