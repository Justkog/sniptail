import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReleaseInfo,
  normalizeReleaseCommit,
  normalizeReleaseVersion,
  writeReleaseInfo,
} from './releaseInfoWriter.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release info writer', () => {
  it('normalizes release versions and commits', () => {
    expect(normalizeReleaseVersion(' v0.2.3 ')).toBe('0.2.3');
    expect(normalizeReleaseCommit('ABC1234def')).toBe('abc1234');
  });

  it('creates deterministic release metadata', () => {
    expect(createReleaseInfo('v0.2.3', 'abc1234def', '2026-06-19T08:00:00.000Z')).toEqual({
      name: 'sniptail',
      version: '0.2.3',
      commit: 'abc1234',
      buildDate: '2026-06-19T08:00:00.000Z',
    });
  });

  it('writes formatted release metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sniptail-release-writer-'));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, 'release-info.json');

    writeReleaseInfo(outputPath, 'v0.2.3', 'abc1234def', '2026-06-19T08:00:00.000Z');

    expect(readFileSync(outputPath, 'utf8')).toBe(
      '{\n' +
        '  "name": "sniptail",\n' +
        '  "version": "0.2.3",\n' +
        '  "commit": "abc1234",\n' +
        '  "buildDate": "2026-06-19T08:00:00.000Z"\n' +
        '}\n',
    );
  });

  it('rejects malformed generation inputs', () => {
    expect(() => normalizeReleaseVersion('v')).toThrow('must not be empty');
    expect(() => normalizeReleaseCommit('not-a-sha')).toThrow('seven hexadecimal');
    expect(() => createReleaseInfo('1.0.0', 'abcdef0', 'not-a-date')).toThrow('ISO timestamp');
  });
});
