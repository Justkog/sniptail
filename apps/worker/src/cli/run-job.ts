import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { StdoutBotEventSink } from '../channels/botEventSink.js';
import { runJob } from '../pipeline.js';

function printUsage() {
  process.stderr.write('Usage: run-job <path-to-job.json>\\n');
}

async function main() {
  const [jobPath] = process.argv.slice(2);
  if (!jobPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  loadWorkerConfig();

  const resolvedPath = resolve(process.cwd(), jobPath);
  let job: JobSpec;
  try {
    const raw = await readFile(resolvedPath, 'utf8');
    job = JSON.parse(raw) as JobSpec;
  } catch (err) {
    logger.error({ err, jobPath: resolvedPath }, 'Failed to read job payload');
    process.exitCode = 1;
    return;
  }

  const events = new StdoutBotEventSink();
  try {
    const result = await runJob(events, job);
    if (events.flush) {
      await events.flush();
    }
    if (result.status !== 'ok') {
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to run job');
    if (events.flush) {
      await events.flush();
    }
    process.exitCode = 1;
  }
}

void main();
