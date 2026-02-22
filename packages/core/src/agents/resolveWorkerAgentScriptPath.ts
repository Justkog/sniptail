import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function buildCandidatePaths(scriptName: string): string[] {
  const rootFromEnv = process.env.SNIPTAIL_ROOT?.trim();
  const candidates: string[] = [];
  if (rootFromEnv) {
    candidates.push(resolve(rootFromEnv, 'apps', 'worker', 'scripts', scriptName));
  }

  candidates.push(resolve(process.cwd(), 'scripts', scriptName));
  candidates.push(resolve(process.cwd(), '..', 'worker', 'scripts', scriptName));
  candidates.push(resolve(process.cwd(), 'apps', 'worker', 'scripts', scriptName));

  return [...new Set(candidates)];
}

export function resolveWorkerAgentScriptPath(scriptName: string): string {
  const candidatePaths = buildCandidatePaths(scriptName);
  const existingPath = candidatePaths.find((candidate) => existsSync(candidate));
  if (existingPath) {
    return existingPath;
  }

  throw new Error(
    [
      `Could not resolve worker runtime script "${scriptName}".`,
      `Tried: ${candidatePaths.join(', ')}`,
      'Set SNIPTAIL_ROOT to the repo root or run from a worker-compatible working directory.',
    ].join(' '),
  );
}
