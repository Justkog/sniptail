import type { ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { buildBootstrapExtrasPrompt } from '../../modals.js';
import { bootstrapExtrasByUser } from '../../state.js';

export async function handleBootstrapStart(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
) {
  if (!config.bootstrapServices.length) {
    await interaction.reply({
      content: 'No bootstrap services are configured for this bot.',
      ephemeral: true,
    });
    return;
  }

  const selection = {
    service: config.bootstrapServices[0]!,
    visibility: 'private' as const,
    quickstart: false,
  };
  bootstrapExtrasByUser.set(interaction.user.id, {
    ...selection,
    requestedAt: Date.now(),
  });

  const prompt = buildBootstrapExtrasPrompt(config.botName, selection, config.bootstrapServices);
  await interaction.reply({
    content: prompt.content,
    components: prompt.components,
    ephemeral: true,
  });
}
