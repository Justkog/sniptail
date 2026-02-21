import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';

export function buildCommandNames(prefix: string) {
  return {
    ask: `${prefix}-ask`,
    plan: `${prefix}-plan`,
    implement: `${prefix}-implement`,
    bootstrap: `${prefix}-bootstrap`,
    clearBefore: `${prefix}-clear-before`,
    usage: `${prefix}-usage`,
  };
}

export async function registerDiscordCommands(
  appId: string,
  token: string,
  botName: string,
  guildId?: string,
) {
  const rest = new REST({ version: '10' }).setToken(token);
  const prefix = toSlackCommandPrefix(botName);
  const names = buildCommandNames(prefix);

  const slashCommands = [
    new SlashCommandBuilder().setName(names.usage).setDescription('Check Codex usage limits'),
  ];

  const commands = [
    ...slashCommands.map((command) => command.toJSON()),
    {
      name: names.ask,
      description: 'Ask a question about one or more repositories',
      type: 1,
    },
    {
      name: names.plan,
      description: 'Plan a change for one or more repositories',
      type: 1,
    },
    {
      name: names.implement,
      description: 'Request a change for one or more repositories',
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
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);

  await rest.put(route, { body: commands });
}
