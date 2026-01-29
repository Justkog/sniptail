import type { ChatInputCommandInteraction } from 'discord.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { buildBootstrapModal } from '../../modals.js';

export async function handleBootstrapStart(interaction: ChatInputCommandInteraction) {
  const modal = buildBootstrapModal(loadBotConfig().botName);
  await interaction.showModal(modal);
}
