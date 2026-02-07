import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(rootDir);
const coreRoot = join(projectRoot, 'packages', 'core');

async function copyMarkdownPrompts(sourceDirParts, targetDirParts) {
  const sourceDir = join(coreRoot, ...sourceDirParts);
  const targetDir = join(coreRoot, ...targetDirParts);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const promptFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));

  await Promise.all(
    promptFiles.map(async (file) => {
      const source = join(sourceDir, file.name);
      const target = join(targetDir, file.name);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }),
  );
}

await Promise.all([
  copyMarkdownPrompts(['src', 'codex', 'prompts'], ['dist', 'codex', 'prompts']),
  copyMarkdownPrompts(['src', 'copilot', 'prompts'], ['dist', 'copilot', 'prompts']),
]);
