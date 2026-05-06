import { describe, expect, it } from 'vitest';
import { buildDiscordCommandDefinitions } from './commands.js';
import { DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES } from './discordContextFiles.js';

describe('buildDiscordCommandDefinitions', () => {
  it('adds attachment options to ask, explore, plan, and implement commands', () => {
    const { names, commands } = buildDiscordCommandDefinitions('Sniptail');
    const commandDefinitions = commands as Array<{
      name: string;
      options?: Array<{
        name: string;
        type: number;
        required?: boolean;
        description?: string;
      }>;
    }>;

    for (const commandName of [names.ask, names.explore, names.plan, names.implement]) {
      const command = commandDefinitions.find((entry) => entry.name === commandName);
      expect(command).toBeDefined();
      expect(command?.options).toHaveLength(DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES.length);

      command?.options?.forEach((option, index) => {
        expect(option).toMatchObject({
          name: DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES[index],
          type: 11,
          required: false,
        });
        expect(option.description).toContain('Optional context file');
      });
    }

    const runCommand = commandDefinitions.find((entry) => entry.name === names.run);
    expect(runCommand?.options).toBeUndefined();
  });

  it('registers the agent command with prompt and autocomplete options', () => {
    const { names, commands } = buildDiscordCommandDefinitions('Sniptail');
    const commandDefinitions = commands as Array<{
      name: string;
      options?: Array<{
        name: string;
        type: number;
        required?: boolean;
        autocomplete?: boolean;
      }>;
    }>;

    const agentCommand = commandDefinitions.find((entry) => entry.name === names.agent);
    expect(agentCommand).toBeDefined();

    const promptOption = agentCommand?.options?.find((option) => option.name === 'prompt');
    expect(promptOption).toMatchObject({
      name: 'prompt',
      type: 3,
      required: true,
    });

    for (const attachmentOptionName of DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES) {
      const attachmentOption = agentCommand?.options?.find(
        (option) => option.name === attachmentOptionName,
      );
      expect(attachmentOption).toMatchObject({
        name: attachmentOptionName,
        type: 11,
        required: false,
      });
    }

    const workspaceOption = agentCommand?.options?.find((option) => option.name === 'workspace');
    expect(workspaceOption).toMatchObject({
      name: 'workspace',
      type: 3,
      required: false,
      autocomplete: true,
    });

    const profileOption = agentCommand?.options?.find((option) => option.name === 'agent_profile');
    expect(profileOption).toMatchObject({
      name: 'agent_profile',
      type: 3,
      required: false,
      autocomplete: true,
    });

    const cwdOption = agentCommand?.options?.find((option) => option.name === 'cwd');
    expect(cwdOption).toMatchObject({
      name: 'cwd',
      type: 3,
      required: false,
      autocomplete: true,
    });
  });
});
