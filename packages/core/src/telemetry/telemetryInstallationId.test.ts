import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getTelemetryInstallationId,
  resetTelemetryInstallationIdForTests,
} from './telemetryInstallationId.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  resetTelemetryInstallationIdForTests();
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('telemetry installation id', () => {
  it('persists and reuses a random UUID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sniptail-telemetry-'));
    tempDirectories.push(directory);
    const path = join(directory, 'nested', 'installation-id');

    const first = await getTelemetryInstallationId(path);
    resetTelemetryInstallationIdForTests();
    const second = await getTelemetryInstallationId(path);

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    expect((await readFile(path, 'utf8')).trim()).toBe(first);
  });

  it('returns one process-local UUID when persistence is unavailable', async () => {
    const path = '/dev/null/sniptail-installation-id';

    const first = await getTelemetryInstallationId(path);
    const second = await getTelemetryInstallationId(path);

    expect(second).toBe(first);
  });
});
