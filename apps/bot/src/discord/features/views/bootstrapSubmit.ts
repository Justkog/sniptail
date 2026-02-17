import type { ModalSubmitInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { listBootstrapProviderIds } from '@sniptail/core/repos/providers.js';
import { enqueueBootstrap } from '@sniptail/core/queue/queue.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { createJobId } from '../../../lib/jobs.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { parseBootstrapExtras } from '../../lib/bootstrap.js';
import { bootstrapExtrasByUser } from '../../state.js';

export async function handleBootstrapModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: Queue<BootstrapRequest>,
) {
  await refreshRepoAllowlist(config);

  const repoName = interaction.fields.getTextInputValue('repo_name').trim();
  const repoKeyInput = interaction.fields.getTextInputValue('repo_key').trim();
  const owner = interaction.fields.getTextInputValue('owner').trim() || undefined;
  const description = interaction.fields.getTextInputValue('description').trim() || undefined;
  const extrasInput = interaction.fields.getTextInputValue('extras').trim();
  const extras = parseBootstrapExtras(extrasInput);
  const selection = bootstrapExtrasByUser.get(interaction.user.id);
  const service = selection?.service;
  const visibility = selection?.visibility ?? 'private';
  const quickstart = selection?.quickstart ?? false;
  const bootstrapServices = listBootstrapProviderIds(config.bootstrapServices);
  if (!service || !bootstrapServices.includes(service)) {
    const allowedServices = bootstrapServices.length
      ? bootstrapServices.join(', ')
      : 'none';
    await interaction.reply({
      content: `Service must be one of: ${allowedServices}.`,
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
    ...(description ? { description } : {}),
    ...(visibility ? { visibility } : {}),
    ...(quickstart ? { quickstart } : {}),
    ...(extras.gitlabNamespaceId !== undefined
      ? { gitlabNamespaceId: extras.gitlabNamespaceId }
      : {}),
    ...(extras.gitlabNamespaceId !== undefined
      ? { providerData: { namespaceId: extras.gitlabNamespaceId } }
      : {}),
    ...(service === 'local' && extras.localPath ? { localPath: extras.localPath } : {}),
    channel: buildInteractionChannelContext(interaction),
  };

  bootstrapExtrasByUser.delete(interaction.user.id);
  await enqueueBootstrap(queue, request);
  await interaction.editReply(`Queued bootstrap for ${repoName}. I'll post updates here.`);
}
