import type { ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { listBootstrapProviderIds } from '@sniptail/core/repos/providers.js';
import { buildBootstrapExtrasPrompt } from '../../modals.js';
import { bootstrapExtrasByUser } from '../../state.js';

export async function handleBootstrapStart(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
) {
  const services = listBootstrapProviderIds(config.bootstrapServices);
  if (!services.length) {
    await interaction.reply({
      content: 'No bootstrap services are configured for this bot.',
      ephemeral: true,
    });
    return;
  }

  const selection = {
    service: services[0]!,
    visibility: 'private' as const,
    quickstart: false,
  };
  bootstrapExtrasByUser.set(interaction.user.id, {
    ...selection,
    requestedAt: Date.now(),
  });

  const prompt = buildBootstrapExtrasPrompt(config.botName, selection, services);
  await interaction.reply({
    content: prompt.content,
    components: prompt.components,
    ephemeral: true,
  });
}
