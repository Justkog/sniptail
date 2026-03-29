import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES } from './discordContextFiles.js';

export function buildCommandNames(prefix: string) {
  return {
    repoAdd: `${prefix}-repo-add`,
    repoRemove: `${prefix}-repo-remove`,
    ask: `${prefix}-ask`,
    explore: `${prefix}-explore`,
    plan: `${prefix}-plan`,
    implement: `${prefix}-implement`,
    run: `${prefix}-run`,
    bootstrap: `${prefix}-bootstrap`,
    clearBefore: `${prefix}-clear-before`,
    usage: `${prefix}-usage`,
  };
}

function buildContextAttachmentOptions() {
  return DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES.map((optionName, index) => ({
    name: optionName,
    description: `Optional context file ${index + 1}`,
    type: 11,
    required: false,
  }));
}

function buildContextJobCommand(name: string, description: string) {
  return {
    name,
    description,
    type: 1,
    options: buildContextAttachmentOptions(),
  };
}

export function buildDiscordCommandDefinitions(botName: string) {
  const prefix = toSlackCommandPrefix(botName);
  const names = buildCommandNames(prefix);

  const slashCommands = [
    new SlashCommandBuilder().setName(names.usage).setDescription('Check Codex usage limits'),
  ];

  const commands = [
    ...slashCommands.map((command) => command.toJSON()),
    {
      name: names.repoAdd,
      description: 'Add an existing repository to the active catalog',
      type: 1,
      options: [
        {
          name: 'repo_key',
          description: 'Catalog key to register',
          type: 3,
          required: true,
        },
        {
          name: 'provider',
          description: 'Repository provider',
          type: 3,
          required: true,
          choices: [
            { name: 'GitHub', value: 'github' },
            { name: 'GitLab', value: 'gitlab' },
            { name: 'Local', value: 'local' },
          ],
        },
        {
          name: 'ssh_url',
          description: 'SSH URL for GitHub or GitLab repositories',
          type: 3,
          required: false,
        },
        {
          name: 'local_path',
          description: 'Local path for local repositories',
          type: 3,
          required: false,
        },
        {
          name: 'project_id',
          description: 'GitLab project ID (required when provider is gitlab)',
          type: 4,
          required: false,
        },
        {
          name: 'base_branch',
          description: 'Default base branch',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: names.repoRemove,
      description: 'Remove an existing repository from the active catalog',
      type: 1,
      options: [
        {
          name: 'repo_key',
          description: 'Catalog key to deactivate',
          type: 3,
          required: true,
        },
      ],
    },
    buildContextJobCommand(names.ask, 'Ask a question about one or more repositories'),
    buildContextJobCommand(names.explore, 'Explore solution options for one or more repositories'),
    buildContextJobCommand(names.plan, 'Plan a change for one or more repositories'),
    buildContextJobCommand(names.implement, 'Request a change for one or more repositories'),
    {
      name: names.run,
      description: 'Run a configured repo action on one or more repositories',
      type: 1,
    },
    {
      name: names.bootstrap,
      description: 'Bootstrap a new repository and allowlist entry',
      type: 1,
    },
    {
      name: names.clearBefore,
      description: 'Clear job data created before a cutoff date',
      type: 1,
      options: [
        {
          name: 'cutoff',
          description: 'YYYY-MM-DD or ISO timestamp',
          type: 3,
          required: true,
        },
      ],
    },
  ];

  return { names, commands };
}

export async function registerDiscordCommands(
  appId: string,
  token: string,
  botName: string,
  guildId?: string,
) {
  const rest = new REST({ version: '10' }).setToken(token);
  const { commands } = buildDiscordCommandDefinitions(botName);
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);

  await rest.put(route, { body: commands });
}
