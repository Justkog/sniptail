import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import {
  buildBootstrapExtrasPrompt,
  buildBootstrapModal,
  type BootstrapExtrasSelection,
  bootstrapContinueButtonCustomId,
  bootstrapQuickstartSelectCustomId,
  bootstrapServiceSelectCustomId,
  bootstrapVisibilitySelectCustomId,
} from '../../modals.js';
import { bootstrapExtrasByUser } from '../../state.js';

function getSelection(
  userId: string,
  services: BootstrapExtrasSelection['service'][],
): BootstrapExtrasSelection {
  const existing = bootstrapExtrasByUser.get(userId);
  const fallbackService = services[0] ?? 'github';
  if (!existing) {
    return {
      service: fallbackService,
      visibility: 'private',
      quickstart: false,
    };
  }
  return {
    service: existing.service ?? fallbackService,
    visibility: existing.visibility,
    quickstart: existing.quickstart,
  };
}

export async function handleBootstrapExtrasSelection(
  interaction: StringSelectMenuInteraction,
  config: BotConfig,
) {
  const value = interaction.values?.[0];
  if (!value) {
    await interaction.reply({ content: 'Please select an option.', ephemeral: true });
    return;
  }

  const selection = getSelection(interaction.user.id, config.bootstrapServices);
  if (interaction.customId === bootstrapServiceSelectCustomId) {
    if (config.bootstrapServices.includes(value as BootstrapExtrasSelection['service'])) {
      selection.service = value as BootstrapExtrasSelection['service'];
    }
  }
  if (interaction.customId === bootstrapVisibilitySelectCustomId) {
    if (value === 'private' || value === 'public') {
      selection.visibility = value;
    }
  }
  if (interaction.customId === bootstrapQuickstartSelectCustomId) {
    selection.quickstart = value === 'true';
  }

  bootstrapExtrasByUser.set(interaction.user.id, {
    ...selection,
    requestedAt: Date.now(),
  });

  const prompt = buildBootstrapExtrasPrompt(config.botName, selection, config.bootstrapServices);
  await interaction.update({
    content: prompt.content,
    components: prompt.components,
  });
}

export async function handleBootstrapExtrasContinue(
  interaction: ButtonInteraction,
  config: BotConfig,
) {
  const selection = getSelection(interaction.user.id, config.bootstrapServices);
  bootstrapExtrasByUser.set(interaction.user.id, {
    ...selection,
    requestedAt: Date.now(),
  });

  const modal = buildBootstrapModal(config.botName);
  await interaction.showModal(modal);
}

export function isBootstrapExtrasCustomId(customId: string) {
  return (
    customId === bootstrapServiceSelectCustomId ||
    customId === bootstrapVisibilitySelectCustomId ||
    customId === bootstrapQuickstartSelectCustomId
  );
}

export function isBootstrapContinueCustomId(customId: string) {
  return customId === bootstrapContinueButtonCustomId;
}
