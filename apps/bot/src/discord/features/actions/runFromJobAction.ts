import type { ButtonInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';
import { buildRunActionSelect } from '../../modals.js';
import { runSelectionByUser } from '../../state.js';
import { buildRunStepModal } from '../../lib/runStepper.js';

export async function handleRunFromJobButton(
  interaction: ButtonInteraction,
  jobId: string,
  config: BotConfig,
) {
  await refreshRepoAllowlist(config);

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for run from job');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: `Unable to open run modal for job ${jobId}.`,
      ephemeral: true,
    });
    return;
  }

  const unknownRepos = repoKeys.filter((key) => !config.repoAllowlist[key]);
  if (unknownRepos.length) {
    await interaction.reply({
      content: `Unknown repo keys: ${unknownRepos.join(', ')}. Update the allowlist and try again.`,
      ephemeral: true,
    });
    return;
  }

  const actions = computeAvailableRunActions(config, repoKeys);
  if (!actions.length) {
    await interaction.reply({
      content: 'No common run actions are available for this job repos.',
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
    const actionId = normalizeRunActionId(actions[0]!.id);
    const selection = {
      repoKeys,
      actionId,
      runStepIndex: 0,
      collectedParams: {},
      gitRef: resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    };
    const modal = buildRunStepModal({ config, selection }).modal;
    runSelectionByUser.set(interaction.user.id, {
      ...selection,
      requestedAt: Date.now(),
    });
    await interaction.showModal(modal);
    return;
  }

  if (actions.length > 25) {
    await interaction.reply({
      content: 'Too many run actions for this repo set (max 25 in Discord). Use Slack.',
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
}
