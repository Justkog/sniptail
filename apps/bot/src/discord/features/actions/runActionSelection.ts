import type { StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';
import { runSelectionByUser } from '../../state.js';
import { buildRunStepModal } from '../../lib/runStepper.js';

export async function handleRunActionSelection(
  interaction: StringSelectMenuInteraction,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const selection = runSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the run command again.',
      ephemeral: true,
    });
    return;
  }

  const selectedActionRaw = interaction.values?.[0]?.trim() ?? '';
  let actionId: string;
  try {
    actionId = normalizeRunActionId(selectedActionRaw);
  } catch {
    await interaction.reply({ content: 'Please select a valid run action.', ephemeral: true });
    return;
  }

  const actions = computeAvailableRunActions(config, repoKeys);
  if (!actions.some((action) => action.id === actionId)) {
    await interaction.reply({
      content: 'Selected action is not available for the chosen repositories.',
      ephemeral: true,
    });
    return;
  }

  runSelectionByUser.set(interaction.user.id, {
    repoKeys,
    actionId,
    runStepIndex: 0,
    collectedParams: {},
    gitRef: resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestedAt: Date.now(),
  });

  const modal = buildRunStepModal({
    config,
    selection: {
      repoKeys,
      actionId,
      runStepIndex: 0,
      collectedParams: {},
      gitRef: resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    },
  }).modal;
  await interaction.showModal(modal);
}
