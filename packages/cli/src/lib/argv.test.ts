import { describe, expect, it } from 'vitest';
import { stripPackageScriptSeparator } from './argv.js';

describe('stripPackageScriptSeparator', () => {
  it('removes the package-script separator before CLI args', () => {
    expect(stripPackageScriptSeparator(['node', 'src/index.ts', '--', 'repos', 'inspect'])).toEqual(
      ['node', 'src/index.ts', 'repos', 'inspect'],
    );
  });

  it('leaves normal argv unchanged', () => {
    const argv = ['node', 'src/index.ts', 'repos', 'inspect'];
    expect(stripPackageScriptSeparator(argv)).toBe(argv);
  });
});
