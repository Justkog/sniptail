import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { runNode } from '../lib/exec.js';
import { resolveSniptailRoot } from '../lib/paths.js';

type SlackManifestOptions = {
  name?: string;
  output?: string;
  cwd?: string;
  root?: string;
};

export function registerSlackManifestCommand(program: Command) {
  program
    .command('slack-manifest')
    .description('Generate a Slack app manifest from the template')
    .option('--name <botName>', 'Bot name to inject into the manifest')
    .option('--output <path>', 'Output path for the manifest')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .action(async (options: SlackManifestOptions) => {
      const baseCwd = resolve(options.cwd ?? process.cwd());
      const root = resolveSniptailRoot({ cwd: baseCwd, root: options.root! });
      const scriptPath = join(root, 'scripts', 'generate-slack-manifest.mjs');

      const args: string[] = [];
      if (options.name) {
        args.push('--name', options.name);
      }
      if (options.output) {
        args.push('--output', options.output);
      }

      await runNode(scriptPath, {
        cwd: baseCwd,
        args,
      });
    });
}
