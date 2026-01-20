import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(rootDir);
const coreRoot = join(projectRoot, 'packages', 'core');
const prompts = ['ask.md', 'implement.md', 'mention.md'];

await Promise.all(
  prompts.map(async (file) => {
    const source = join(coreRoot, 'src', 'codex', 'prompts', file);
    const target = join(coreRoot, 'dist', 'codex', 'prompts', file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }),
);
