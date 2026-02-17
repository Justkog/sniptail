import type { Command } from 'commander';
import { join } from 'node:path';
import { runRuntime } from '../lib/runtime.js';

type RuntimeOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
};

type ReposAddOptions = RuntimeOptions & {
  sshUrl?: string;
  localPath?: string;
  projectId?: string;
  baseBranch?: string;
  provider?: string;
  ifMissing?: boolean;
  upsert?: boolean;
  json?: boolean;
};

type ReposListOptions = RuntimeOptions & {
  provider?: string;
  json?: boolean;
};

type ReposRemoveOptions = RuntimeOptions & {
  yes?: boolean;
  json?: boolean;
};

type ReposSyncFileOptions = RuntimeOptions & {
  path?: string;
  json?: boolean;
};

function appendRuntimeOptions(command: Command): Command {
  return command
    .option('--config <path>', 'Path to sniptail.worker.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root');
}

async function runReposRuntime(options: RuntimeOptions, args: string[]): Promise<void> {
  await runRuntime({
    app: 'worker',
    entry: join('dist', 'cli', 'repos.js'),
    configEnvVar: 'SNIPTAIL_WORKER_CONFIG_PATH',
    ...(options.config ? { configPath: options.config } : {}),
    ...(options.env ? { envPath: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.root ? { root: options.root } : {}),
    args,
  });
}

export function registerReposCommand(program: Command) {
  const repos = program.command('repos').description('Manage repository catalog entries');

  appendRuntimeOptions(
    repos
      .command('add <repoKey>')
      .description('Add or update an existing repository catalog entry')
      .option('--ssh-url <url>', 'SSH URL for remote repositories')
      .option('--local-path <path>', 'Local filesystem path for local repositories')
      .option('--project-id <number>', 'GitLab project ID (required for GitLab)')
      .option('--base-branch <name>', 'Default base branch (default: main)')
      .option(
        '--provider <provider>',
        'Repository provider id (for example: github, gitlab, local)',
      )
      .option('--if-missing', 'Skip when the repository key already exists')
      .option('--upsert', 'Update the repository if the key already exists')
      .option('--json', 'Print JSON output')
      .action(async (repoKey: string, options: ReposAddOptions) => {
        const args = ['add', repoKey];
        if (options.sshUrl) args.push('--ssh-url', options.sshUrl);
        if (options.localPath) args.push('--local-path', options.localPath);
        if (options.projectId) args.push('--project-id', options.projectId);
        if (options.baseBranch) args.push('--base-branch', options.baseBranch);
        if (options.provider) args.push('--provider', options.provider);
        if (options.ifMissing) args.push('--if-missing');
        if (options.upsert) args.push('--upsert');
        if (options.json) args.push('--json');

        await runReposRuntime(options, args);
      }),
  );

  appendRuntimeOptions(
    repos
      .command('list')
      .description('List active repository catalog entries')
      .option('--provider <provider>', 'Filter by provider id')
      .option('--json', 'Print JSON output')
      .action(async (options: ReposListOptions) => {
        const args = ['list'];
        if (options.provider) args.push('--provider', options.provider);
        if (options.json) args.push('--json');

        await runReposRuntime(options, args);
      }),
  );

  appendRuntimeOptions(
    repos
      .command('remove <repoKey>')
      .description('Deactivate a repository catalog entry')
      .option('--yes', 'Skip confirmation prompt')
      .option('--json', 'Print JSON output')
      .action(async (repoKey: string, options: ReposRemoveOptions) => {
        const args = ['remove', repoKey];
        if (options.yes) args.push('--yes');
        if (options.json) args.push('--json');

        await runReposRuntime(options, args);
      }),
  );

  appendRuntimeOptions(
    repos
      .command('sync-file')
      .description('Write catalog entries to allowlist JSON file')
      .option('--path <file>', 'Output path (defaults to repo_allowlist_path)')
      .option('--json', 'Print JSON output')
      .action(async (options: ReposSyncFileOptions) => {
        const args = ['sync-file'];
        if (options.path) args.push('--path', options.path);
        if (options.json) args.push('--json');

        await runReposRuntime(options, args);
      }),
  );
}
