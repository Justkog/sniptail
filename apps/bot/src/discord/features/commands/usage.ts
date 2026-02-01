import type { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';

export async function handleUsage(interaction: ChatInputCommandInteraction) {
  const { fetchCodexUsageMessage } = await import('@sniptail/core/codex/status.js');
  try {
    const { message } = await fetchCodexUsageMessage();
    await interaction.editReply(message);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch Codex usage status');
    await interaction.editReply('Failed to fetch Codex usage status. Please try again shortly.');
  }
}
