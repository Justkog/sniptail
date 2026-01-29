import type { ModalSubmitInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { enqueueBootstrap } from '@sniptail/core/queue/queue.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { createJobId } from '../../../lib/jobs.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { parseBootstrapExtras } from '../../lib/bootstrap.js';

export async function handleBootstrapModalSubmit(
  interaction: ModalSubmitInteraction,
  queue: Queue<BootstrapRequest>,
) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const repoName = interaction.fields.getTextInputValue('repo_name').trim();
  const repoKeyInput = interaction.fields.getTextInputValue('repo_key').trim();
  const serviceInput = interaction.fields.getTextInputValue('service').trim().toLowerCase();
  const owner = interaction.fields.getTextInputValue('owner').trim() || undefined;
  const extrasInput = interaction.fields.getTextInputValue('extras').trim();
  const extras = parseBootstrapExtras(extrasInput);

  const service = serviceInput as BootstrapRequest['service'];
  if (!['github', 'gitlab', 'local'].includes(service)) {
    await interaction.reply({
      content: 'Service must be one of: github, gitlab, local.',
      ephemeral: true,
    });
    return;
  }

  const repoKey = sanitizeRepoKey(repoKeyInput || repoName);
  if (!repoKey) {
    await interaction.reply({
      content: 'Repository key must include letters or numbers.',
      ephemeral: true,
    });
    return;
  }
  if (service === 'local' && !extras.localPath) {
    await interaction.reply({
      content: 'Local path is required when service is local.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const requestId = createJobId('bootstrap');
  const request: BootstrapRequest = {
    requestId,
    repoName,
    repoKey,
    service,
    ...(owner ? { owner } : {}),
    ...(extras.description ? { description: extras.description } : {}),
    ...(extras.visibility ? { visibility: extras.visibility } : {}),
    ...(extras.quickstart ? { quickstart: extras.quickstart } : {}),
    ...(extras.gitlabNamespaceId !== undefined
      ? { gitlabNamespaceId: extras.gitlabNamespaceId }
      : {}),
    ...(service === 'local' && extras.localPath ? { localPath: extras.localPath } : {}),
    channel: buildInteractionChannelContext(interaction),
  };

  await enqueueBootstrap(queue, request);
  await interaction.editReply(`Queued bootstrap for ${repoName}. I'll post updates here.`);
}
