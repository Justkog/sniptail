import type { ButtonInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { runParamsContinueButtonCustomId } from '../../modals.js';
import { runSelectionByUser } from '../../state.js';
import { buildRunStepModal } from '../../lib/runStepper.js';

export async function handleRunParamsContinue(interaction: ButtonInteraction, config: BotConfig) {
  const selection = runSelectionByUser.get(interaction.user.id);
  if (!selection?.actionId) {
    await interaction.reply({
      content: 'Run selection expired. Start the run command again.',
      ephemeral: true,
    });
    return;
  }

  const { modal } = buildRunStepModal({
    config,
    selection: {
      repoKeys: selection.repoKeys,
      actionId: selection.actionId,
      runStepIndex: selection.runStepIndex ?? 0,
      collectedParams: selection.collectedParams ?? {},
      ...(selection.gitRef ? { gitRef: selection.gitRef } : {}),
    },
  });

  await interaction.showModal(modal);
}

export function isRunParamsContinueCustomId(customId: string) {
  return customId === runParamsContinueButtonCustomId;
}
