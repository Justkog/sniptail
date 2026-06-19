import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseReleaseInfo, readReleaseInfo, resolveSniptailVersion } from './releaseInfo.js';

const originalVersion = process.env.SNIPTAIL_VERSION;
const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sniptail-release-info-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

afterEach(() => {
  if (originalVersion === undefined) {
    delete process.env.SNIPTAIL_VERSION;
  } else {
    process.env.SNIPTAIL_VERSION = originalVersion;
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release info', () => {
  it('resolves the environment override before release metadata', () => {
    const root = makeTemporaryDirectory();
    const releaseInfoPath = join(root, 'release-info.json');
    writeJson(releaseInfoPath, {
      name: 'sniptail',
      version: '1.2.3',
      commit: 'abcdef0',
      buildDate: '2026-06-19T08:00:00.000Z',
    });
    process.env.SNIPTAIL_VERSION = ' 9.8.7 ';

    expect(
      resolveSniptailVersion(pathToFileURL(join(root, 'src', 'index.ts')).href, releaseInfoPath),
    ).toBe('9.8.7');
  });

  it('uses release metadata before the nearest package version', () => {
    const root = makeTemporaryDirectory();
    const releaseInfoPath = join(root, 'release-info.json');
    writeJson(join(root, 'package.json'), { version: '4.5.6' });
    writeJson(releaseInfoPath, {
      name: 'sniptail',
      version: '1.2.3',
      commit: 'abcdef0',
      buildDate: '2026-06-19T08:00:00.000Z',
    });
    delete process.env.SNIPTAIL_VERSION;

    expect(
      resolveSniptailVersion(pathToFileURL(join(root, 'src', 'index.ts')).href, releaseInfoPath),
    ).toBe('1.2.3');
  });

  it('falls back to the nearest package when release metadata is missing or invalid', () => {
    const root = makeTemporaryDirectory();
    const cliCaller = join(root, 'packages', 'cli', 'src', 'index.ts');
    const coreCaller = join(root, 'packages', 'core', 'src', 'telemetry', 'telemetry.ts');
    writeJson(join(root, 'package.json'), { version: '1.0.0' });
    writeJson(join(root, 'packages', 'cli', 'package.json'), { version: '2.0.0' });
    writeJson(join(root, 'packages', 'core', 'package.json'), { version: '3.0.0' });
    delete process.env.SNIPTAIL_VERSION;

    expect(resolveSniptailVersion(pathToFileURL(cliCaller).href, join(root, 'missing.json'))).toBe(
      '2.0.0',
    );
    expect(resolveSniptailVersion(pathToFileURL(coreCaller).href, join(root, 'missing.json'))).toBe(
      '3.0.0',
    );

    const malformedPath = join(root, 'release-info.json');
    writeFileSync(malformedPath, '{', 'utf8');
    expect(resolveSniptailVersion(pathToFileURL(cliCaller).href, malformedPath)).toBe('2.0.0');
  });

  it('returns unknown when no version source is valid', () => {
    const root = makeTemporaryDirectory();
    delete process.env.SNIPTAIL_VERSION;

    expect(
      resolveSniptailVersion(
        pathToFileURL(join(root, 'src', 'index.ts')).href,
        join(root, 'missing.json'),
      ),
    ).toBe('unknown');
  });

  it('treats a whitespace-only environment value as absent', () => {
    const root = makeTemporaryDirectory();
    writeJson(join(root, 'package.json'), { version: '3.2.1' });
    process.env.SNIPTAIL_VERSION = '   ';

    expect(
      resolveSniptailVersion(
        pathToFileURL(join(root, 'src', 'index.ts')).href,
        join(root, 'missing.json'),
      ),
    ).toBe('3.2.1');
  });

  it('rejects malformed fields and non-ISO dates', () => {
    expect(parseReleaseInfo(undefined)).toBeUndefined();
    expect(
      parseReleaseInfo({
        name: 'sniptail',
        version: 123,
        commit: 'abcdef0',
        buildDate: '2026-06-19T08:00:00.000Z',
      }),
    ).toBeUndefined();
    expect(
      parseReleaseInfo({
        name: 'sniptail',
        version: '1.2.3',
        commit: 'abcdef0',
        buildDate: 'June 19, 2026',
      }),
    ).toBeUndefined();
  });

  it('reads valid release metadata', () => {
    const root = makeTemporaryDirectory();
    const releaseInfoPath = join(root, 'release-info.json');
    const expected = {
      name: 'sniptail',
      version: '1.2.3',
      commit: 'abcdef0',
      buildDate: '2026-06-19T08:00:00.000Z',
    };
    writeJson(releaseInfoPath, expected);

    expect(readReleaseInfo(releaseInfoPath)).toEqual(expected);
  });
});
