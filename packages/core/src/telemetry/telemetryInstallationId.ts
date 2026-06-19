import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const TELEMETRY_INSTALLATION_ID_PATH = join(
  homedir(),
  '.sniptail',
  'telemetry',
  'installation-id',
);

let processInstallationId: string | undefined;
let installationIdPromise: Promise<string> | undefined;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readPersistedInstallationId(path: string): Promise<string | undefined> {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return isUuid(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function createPersistedInstallationId(path: string, candidate: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(`${candidate}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    return candidate;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
    return (await readPersistedInstallationId(path)) ?? candidate;
  }
}

async function loadInstallationId(path: string): Promise<string> {
  const persisted = await readPersistedInstallationId(path);
  if (persisted) return persisted;

  const candidate = randomUUID();
  try {
    return await createPersistedInstallationId(path, candidate);
  } catch {
    return candidate;
  }
}

export async function getTelemetryInstallationId(
  path = TELEMETRY_INSTALLATION_ID_PATH,
): Promise<string> {
  if (processInstallationId) return processInstallationId;
  installationIdPromise ??= loadInstallationId(path);
  processInstallationId = await installationIdPromise;
  return processInstallationId;
}

export function resetTelemetryInstallationIdForTests(): void {
  processInstallationId = undefined;
  installationIdPromise = undefined;
}
