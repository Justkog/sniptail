import { describe, expect, it } from 'vitest';
import { buildDiscordCommandDefinitions } from './commands.js';
import { DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES } from './discordContextFiles.js';

describe('buildDiscordCommandDefinitions', () => {
  it('adds attachment options to ask, explore, plan, and implement commands', () => {
    const { names, commands } = buildDiscordCommandDefinitions('Sniptail');
    const commandDefinitions = commands as Array<{
      name: string;
      options?: Array<{ name: string; type: number; required?: boolean }>;
    }>;

    for (const commandName of [names.ask, names.explore, names.plan, names.implement]) {
      const command = commandDefinitions.find((entry) => entry.name === commandName);
      expect(command).toBeDefined();
      expect(command?.options).toEqual(
        DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES.map((optionName) => ({
          description: expect.stringContaining('Optional context file'),
          name: optionName,
          type: 11,
          required: false,
        })),
      );
    }

    const runCommand = commandDefinitions.find((entry) => entry.name === names.run);
    expect(runCommand?.options).toBeUndefined();
  });
});