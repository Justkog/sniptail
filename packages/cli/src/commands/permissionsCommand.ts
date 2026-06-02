import type { Command } from 'commander';
import { join } from 'node:path';
import { runRuntime } from '../lib/runtime.js';

type RuntimeOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
};

type PermissionsExplainOptions = RuntimeOptions & {
  action: string;
  provider: string;
  channelId: string;
  userId: string;
  groupId?: string[];
  repo?: string[];
  threadId?: string;
  workspaceId?: string;
  guildId?: string;
  json?: boolean;
};

function appendRuntimeOptions(command: Command): Command {
  return command
    .option('--config <path>', 'Path to sniptail.bot.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root');
}

async function runPermissionsRuntime(options: RuntimeOptions, args: string[]): Promise<void> {
  await runRuntime({
    app: 'bot',
    entrypoint: {
      source: join('src', 'cli', 'permissions.ts'),
      dist: join('dist', 'cli', 'permissions.js'),
    },
    configEnvVar: 'SNIPTAIL_BOT_CONFIG_PATH',
    ...(options.config ? { configPath: options.config } : {}),
    ...(options.env ? { envPath: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.root ? { root: options.root } : {}),
    args,
  });
}

export function registerPermissionsCommand(program: Command) {
  const permissions = program
    .command('permissions')
    .description('Inspect Sniptail permission policy decisions');

  appendRuntimeOptions(
    permissions
      .command('explain')
      .description('Explain one permission decision')
      .requiredOption('--action <action>', 'Permission action')
      .requiredOption('--provider <provider>', 'Channel provider')
      .requiredOption('--channel-id <id>', 'Channel id')
      .requiredOption('--user-id <id>', 'User id')
      .option('--group-id <id>', 'Known group or role id', (value, previous: string[] = []) => [
        ...previous,
        value,
      ])
      .option(
        '--repo <repoKey>',
        'Repository key for context',
        (value, previous: string[] = []) => [...previous, value],
      )
      .option('--thread-id <id>', 'Thread id')
      .option('--workspace-id <id>', 'Workspace id')
      .option('--guild-id <id>', 'Discord guild id')
      .option('--json', 'Print JSON output')
      .action(async (options: PermissionsExplainOptions) => {
        const args = [
          'explain',
          '--action',
          options.action,
          '--provider',
          options.provider,
          '--channel-id',
          options.channelId,
          '--user-id',
          options.userId,
        ];
        for (const groupId of options.groupId ?? []) {
          args.push('--group-id', groupId);
        }
        for (const repo of options.repo ?? []) {
          args.push('--repo', repo);
        }
        if (options.threadId) args.push('--thread-id', options.threadId);
        if (options.workspaceId) args.push('--workspace-id', options.workspaceId);
        if (options.guildId) args.push('--guild-id', options.guildId);
        if (options.json) args.push('--json');

        await runPermissionsRuntime(options, args);
      }),
  );
}
