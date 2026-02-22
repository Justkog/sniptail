import type { ChatInputCommandInteraction } from 'discord.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';
import { buildRunActionSelect, buildRunModal, buildRunRepoSelect } from '../../modals.js';
import { runSelectionByUser } from '../../state.js';

export async function handleRunStart(interaction: ChatInputCommandInteraction, config: BotConfig) {
  await refreshRepoAllowlist(config);

  const repoKeys = Object.keys(config.repoAllowlist);
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'No repositories are allowlisted yet. Update the allowlist and try again.',
      ephemeral: true,
    });
    return;
  }

  if (repoKeys.length > 25) {
    await interaction.reply({
      content:
        'Too many repositories to list in Discord (max 25). Use Slack or narrow the allowlist.',
      ephemeral: true,
    });
    return;
  }

  if (repoKeys.length === 1) {
    const selectedRepoKeys = [repoKeys[0]!];
    const actions = computeAvailableRunActions(config, selectedRepoKeys);
    if (!actions.length) {
      await interaction.reply({
        content:
          'No run actions are available for this repository. Sync run metadata or update bot run action config.',
        ephemeral: true,
      });
      return;
    }

    runSelectionByUser.set(interaction.user.id, {
      repoKeys: selectedRepoKeys,
      ...(actions.length === 1 ? { actionId: normalizeRunActionId(actions[0]!.id) } : {}),
      requestedAt: Date.now(),
    });

    if (actions.length === 1) {
      const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, selectedRepoKeys[0]);
      const modal = buildRunModal(config.botName, selectedRepoKeys, baseBranch);
      await interaction.showModal(modal);
      return;
    }

    if (actions.length > 25) {
      await interaction.reply({
        content:
          'Too many run actions for this repo (max 25 in Discord). Use Slack or narrow config.',
        ephemeral: true,
      });
      return;
    }

    const row = buildRunActionSelect(
      actions.map((action) => ({ id: action.id, label: action.label })),
    );
    await interaction.reply({
      content: 'Select a run action.',
      components: [row],
      ephemeral: true,
    });
    return;
  }

  const row = buildRunRepoSelect(repoKeys);
  await interaction.reply({
    content: 'Select repositories for your run action.',
    components: [row],
    ephemeral: true,
  });
}
