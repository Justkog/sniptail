import type { StringSelectMenuInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';
import { buildRunActionSelect, buildRunModal } from '../../modals.js';
import { runSelectionByUser } from '../../state.js';

export async function handleRunRepoSelection(
  interaction: StringSelectMenuInteraction,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const repoKeys = interaction.values ?? [];
  if (!repoKeys.length) {
    await interaction.reply({ content: 'Please select at least one repository.', ephemeral: true });
    return;
  }

  const actions = computeAvailableRunActions(config, repoKeys);
  if (!actions.length) {
    await interaction.reply({
      content: 'No common run actions are available for the selected repositories.',
      ephemeral: true,
    });
    return;
  }

  runSelectionByUser.set(interaction.user.id, {
    repoKeys,
    ...(actions.length === 1 ? { actionId: normalizeRunActionId(actions[0]!.id) } : {}),
    requestedAt: Date.now(),
  });

  if (actions.length === 1) {
    const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const modal = buildRunModal(config.botName, repoKeys, baseBranch);
    await interaction.showModal(modal);
    return;
  }

  if (actions.length > 25) {
    await interaction.reply({
      content: 'Too many run actions for the selected repos (max 25 in Discord). Use Slack.',
      ephemeral: true,
    });
    return;
  }

  const row = buildRunActionSelect(
    actions.map((action) => ({ id: action.id, label: action.label })),
  );
  await interaction.update({
    content: 'Select a run action.',
    components: [row],
  });
}
