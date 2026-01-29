import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  LabelBuilder,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueBootstrap, enqueueJob } from '@sniptail/core/queue/queue.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { ChannelContext } from '@sniptail/core/types/channel.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { Queue } from 'bullmq';
import { resolveDefaultBaseBranch } from '../slack/modals.js';
import { refreshRepoAllowlist } from '../slack/lib/repoAllowlist.js';
import { dedupe } from '../slack/lib/dedupe.js';
import { parseCommaList } from '../slack/lib/parsing.js';
import { createJobId } from '../lib/jobs.js';
import { fetchDiscordThreadContext, stripDiscordMentions } from './threadContext.js';

const defaultGitRef = 'main';
const askRepoSelectCustomId = 'ask_repo_select';
const askModalCustomId = 'ask_modal';
const implementRepoSelectCustomId = 'implement_repo_select';
const implementModalCustomId = 'implement_modal';
const bootstrapModalCustomId = 'bootstrap_modal';
const askSelectionByUser = new Map<string, { repoKeys: string[]; requestedAt: number }>();
const implementSelectionByUser = new Map<string, { repoKeys: string[]; requestedAt: number }>();

function buildCommandNames(prefix: string) {
  return {
    ask: `${prefix}-ask`,
    implement: `${prefix}-implement`,
    bootstrap: `${prefix}-bootstrap`,
    usage: `${prefix}-usage`,
  };
}

function isChannelAllowed(channelIds: string[] | undefined, channelId: string): boolean {
  if (!channelIds || channelIds.length === 0) return true;
  return channelIds.includes(channelId);
}

function buildChannelContext(message: Message): ChannelContext {
  return {
    provider: 'discord',
    channelId: message.channelId,
    threadId: message.channelId,
    userId: message.author.id,
    ...(message.guildId ? { guildId: message.guildId } : {}),
  };
}

function buildInteractionChannelContext(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
): ChannelContext {
  const channelId = interaction.channelId ?? interaction.user.id;
  return {
    provider: 'discord',
    channelId,
    threadId: channelId,
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
  };
}

async function registerDiscordCommands(appId: string, token: string, guildId?: string) {
  const rest = new REST({ version: '10' }).setToken(token);
  const prefix = toSlackCommandPrefix(loadBotConfig().botName);
  const names = buildCommandNames(prefix);

  const slashCommands = [
    new SlashCommandBuilder().setName(names.usage).setDescription('Check Codex usage limits'),
  ];

  const commands = [
    ...slashCommands.map((command) => command.toJSON()),
    {
      name: names.ask,
      description: 'Ask a question about one or more repositories',
      type: 1,
    },
    {
      name: names.implement,
      description: 'Request a change for one or more repositories',
      type: 1,
    },
    {
      name: names.bootstrap,
      description: 'Bootstrap a new repository and allowlist entry',
      type: 1,
    },
  ];
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);

  await rest.put(route, { body: commands });
}

function buildImplementRepoSelect(repoKeys: string[]) {
  const options = repoKeys.map((key) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(key)
      .setValue(key)
      .setDefault(repoKeys.length === 1),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(implementRepoSelectCustomId)
    .setPlaceholder('Select repositories')
    .setMinValues(1)
    .setMaxValues(Math.min(repoKeys.length, 25))
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildAskRepoSelect(repoKeys: string[]) {
  const options = repoKeys.map((key) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(key)
      .setValue(key)
      .setDefault(repoKeys.length === 1),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(askRepoSelectCustomId)
    .setPlaceholder('Select repositories')
    .setMinValues(1)
    .setMaxValues(Math.min(repoKeys.length, 25))
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildAskModal(
  botName: string,
  repoKeys: string[],
  baseBranch: string,
  resumeFromJobId?: string,
) {
  const modal = new ModalBuilder().setCustomId(askModalCustomId).setTitle(`${botName} Ask`);

  const branchInput = new TextInputBuilder()
    .setCustomId('git_ref')
    .setStyle(TextInputStyle.Short)
    .setValue(baseBranch);

  const questionInput = new TextInputBuilder()
    .setCustomId('question')
    .setStyle(TextInputStyle.Paragraph);

  const resumeInput = new TextInputBuilder()
    .setCustomId('resume_from')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  if (resumeFromJobId) {
    resumeInput.setValue(resumeFromJobId);
  }

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Base branch').setTextInputComponent(branchInput),
    new LabelBuilder().setLabel('Question').setTextInputComponent(questionInput),
    new LabelBuilder().setLabel('Resume from job ID (optional)').setTextInputComponent(resumeInput),
  );

  if (repoKeys.length > 1) {
    modal.setTitle(`${botName} Ask (${repoKeys.length} repos)`);
  }

  return modal;
}

function buildBootstrapModal(botName: string) {
  const modal = new ModalBuilder()
    .setCustomId(bootstrapModalCustomId)
    .setTitle(`${botName} Bootstrap`);

  const repoNameInput = new TextInputBuilder()
    .setCustomId('repo_name')
    .setStyle(TextInputStyle.Short);

  const serviceInput = new TextInputBuilder()
    .setCustomId('service')
    .setStyle(TextInputStyle.Short)
    .setValue('github');

  const repoKeyInput = new TextInputBuilder()
    .setCustomId('repo_key')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const ownerInput = new TextInputBuilder()
    .setCustomId('owner')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const extrasInput = new TextInputBuilder()
    .setCustomId('extras')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Repository name').setTextInputComponent(repoNameInput),
    new LabelBuilder()
      .setLabel('Service (github | gitlab | local)')
      .setTextInputComponent(serviceInput),
    new LabelBuilder().setLabel('Allowlist key (optional)').setTextInputComponent(repoKeyInput),
    new LabelBuilder().setLabel('Owner/namespace (optional)').setTextInputComponent(ownerInput),
    new LabelBuilder()
      .setLabel('Extras (optional)')
      .setDescription(
        'description=..., visibility=private|public, quickstart=true|false, gitlab_namespace_id=123, local_path=path',
      )
      .setTextInputComponent(extrasInput),
  );

  return modal;
}

function buildImplementModal(
  botName: string,
  repoKeys: string[],
  baseBranch: string,
  resumeFromJobId?: string,
) {
  const modal = new ModalBuilder()
    .setCustomId(implementModalCustomId)
    .setTitle(`${botName} Implement`);

  const branchInput = new TextInputBuilder()
    .setCustomId('git_ref')
    .setStyle(TextInputStyle.Short)
    .setValue(baseBranch);

  const changeInput = new TextInputBuilder()
    .setCustomId('request_text')
    .setStyle(TextInputStyle.Paragraph);

  const reviewersInput = new TextInputBuilder()
    .setCustomId('reviewers')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const labelsInput = new TextInputBuilder()
    .setCustomId('labels')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const resumeInput = new TextInputBuilder()
    .setCustomId('resume_from')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  if (resumeFromJobId) {
    resumeInput.setValue(resumeFromJobId);
  }

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Base branch').setTextInputComponent(branchInput),
    new LabelBuilder().setLabel('Change request').setTextInputComponent(changeInput),
    new LabelBuilder()
      .setLabel('Reviewers (GitLab IDs or GitHub usernames)')
      .setTextInputComponent(reviewersInput),
    new LabelBuilder().setLabel('Labels (comma-separated)').setTextInputComponent(labelsInput),
    new LabelBuilder().setLabel('Resume from job ID (optional)').setTextInputComponent(resumeInput),
  );

  if (repoKeys.length > 1) {
    modal.setTitle(`${botName} Implement (${repoKeys.length} repos)`);
  }

  return modal;
}

async function handleImplementStart(interaction: ChatInputCommandInteraction) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const repoKeys = Object.keys(config.repoAllowlist);
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'No repositories are allowlisted yet. Update the allowlist and try again.',
      ephemeral: true,
    });
    return;
  }
  if (repoKeys.length === 1) {
    implementSelectionByUser.set(interaction.user.id, {
      repoKeys,
      requestedAt: Date.now(),
    });
    const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const modal = buildImplementModal(config.botName, repoKeys, baseBranch);
    await interaction.showModal(modal);
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

  const row = buildImplementRepoSelect(repoKeys);
  await interaction.reply({
    content: 'Select repositories for your change request.',
    components: [row],
    ephemeral: true,
  });
}

async function handleAskStart(interaction: ChatInputCommandInteraction) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const repoKeys = Object.keys(config.repoAllowlist);
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'No repositories are allowlisted yet. Update the allowlist and try again.',
      ephemeral: true,
    });
    return;
  }
  if (repoKeys.length === 1) {
    askSelectionByUser.set(interaction.user.id, {
      repoKeys,
      requestedAt: Date.now(),
    });
    const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const modal = buildAskModal(config.botName, repoKeys, baseBranch);
    await interaction.showModal(modal);
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

  const row = buildAskRepoSelect(repoKeys);
  await interaction.reply({
    content: 'Select repositories for your question.',
    components: [row],
    ephemeral: true,
  });
}

async function handleBootstrapStart(interaction: ChatInputCommandInteraction) {
  const modal = buildBootstrapModal(loadBotConfig().botName);
  await interaction.showModal(modal);
}

async function handleAskSelection(interaction: StringSelectMenuInteraction) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const repoKeys = interaction.values ?? [];
  if (!repoKeys.length) {
    await interaction.reply({ content: 'Please select at least one repository.', ephemeral: true });
    return;
  }

  askSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildAskModal(config.botName, repoKeys, baseBranch);
  await interaction.showModal(modal);
}

async function handleAskModalSubmit(interaction: ModalSubmitInteraction, queue: Queue<JobSpec>) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const selection = askSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the ask command again.',
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

  await interaction.deferReply({ ephemeral: true });

  const gitRef = interaction.fields.getTextInputValue('git_ref').trim();
  const requestText = interaction.fields.getTextInputValue('question').trim();
  const resumeFromInput = interaction.fields.getTextInputValue('resume_from').trim();
  const resumeFromJobId = resumeFromInput || undefined;

  const job: JobSpec = {
    jobId: createJobId('ask'),
    type: 'ASK',
    repoKeys,
    ...(repoKeys[0] && { primaryRepoKey: repoKeys[0] }),
    gitRef: gitRef || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestText,
    agent: config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    ...(resumeFromJobId ? { resumeFromJobId } : {}),
  };

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
    await interaction.editReply(`I couldn't persist job ${job.jobId}. Please try again.`);
    return;
  }

  await enqueueJob(queue, job);
  askSelectionByUser.delete(interaction.user.id);
  await interaction.editReply(`Thanks! I've accepted job ${job.jobId}. I'll report back here.`);
}

async function handleImplementSelection(interaction: StringSelectMenuInteraction) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const repoKeys = interaction.values ?? [];
  if (!repoKeys.length) {
    await interaction.reply({ content: 'Please select at least one repository.', ephemeral: true });
    return;
  }

  implementSelectionByUser.set(interaction.user.id, {
    repoKeys,
    requestedAt: Date.now(),
  });

  const baseBranch = resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
  const modal = buildImplementModal(config.botName, repoKeys, baseBranch);
  await interaction.showModal(modal);
}

async function handleImplementModalSubmit(
  interaction: ModalSubmitInteraction,
  queue: Queue<JobSpec>,
) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const selection = implementSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the implement command again.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const gitRef = interaction.fields.getTextInputValue('git_ref').trim();
  const requestText = interaction.fields.getTextInputValue('request_text').trim();
  const reviewersInput = interaction.fields.getTextInputValue('reviewers').trim();
  const labelsInput = interaction.fields.getTextInputValue('labels').trim();
  const resumeFromInput = interaction.fields.getTextInputValue('resume_from').trim();

  const reviewers = reviewersInput ? parseCommaList(reviewersInput) : undefined;
  const labels = labelsInput ? parseCommaList(labelsInput) : undefined;
  const resumeFromJobId = resumeFromInput || undefined;

  const job: JobSpec = {
    jobId: createJobId('implement'),
    type: 'IMPLEMENT',
    repoKeys,
    ...(repoKeys[0] && { primaryRepoKey: repoKeys[0] }),
    gitRef: gitRef || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestText,
    agent: config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    ...(resumeFromJobId ? { resumeFromJobId } : {}),
  };

  if (reviewers || labels) {
    job.settings = {
      ...(reviewers ? { reviewers } : {}),
      ...(labels ? { labels } : {}),
    };
  }

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
    await interaction.editReply(`I couldn't persist job ${job.jobId}. Please try again.`);
    return;
  }

  await enqueueJob(queue, job);
  implementSelectionByUser.delete(interaction.user.id);
  await interaction.editReply(`Thanks! I've accepted job ${job.jobId}. I'll report back here.`);
}

function parseBootstrapExtras(value: string) {
  const extras: {
    description?: string;
    visibility?: 'private' | 'public';
    quickstart?: boolean;
    gitlabNamespaceId?: number;
    localPath?: string;
  } = {};
  if (!value.trim()) return extras;

  const pairs = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split('=');
    const key = rawKey?.trim().toLowerCase();
    const rawValue = rest.join('=').trim();
    if (!key || !rawValue) continue;

    if (key === 'description') {
      extras.description = rawValue;
    } else if (key === 'visibility') {
      const normalized = rawValue.toLowerCase();
      if (normalized === 'private' || normalized === 'public') {
        extras.visibility = normalized;
      }
    } else if (key === 'quickstart') {
      const normalized = rawValue.toLowerCase();
      extras.quickstart = ['true', 'yes', '1', 'y'].includes(normalized);
    } else if (key === 'gitlab_namespace_id') {
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isNaN(parsed)) {
        extras.gitlabNamespaceId = parsed;
      }
    } else if (key === 'local_path') {
      extras.localPath = rawValue;
    }
  }

  return extras;
}

async function handleBootstrapModalSubmit(
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

async function handleUsage(interaction: ChatInputCommandInteraction) {
  const { fetchCodexUsageMessage } = await import('@sniptail/core/codex/status.js');
  try {
    const { message } = await fetchCodexUsageMessage();
    await interaction.editReply(message);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch Codex usage status');
    await interaction.editReply('Failed to fetch Codex usage status. Please try again shortly.');
  }
}

async function handleMention(message: Message, queue: Queue<JobSpec>) {
  if (!message.mentions.has(message.client.user)) {
    return;
  }

  const config = loadBotConfig();
  const dedupeKey = `${message.channelId}:${message.id}:mention`;
  if (dedupe(dedupeKey)) return;

  try {
    await message.react('👀');
  } catch (err) {
    logger.warn({ err, messageId: message.id }, 'Failed to add Discord mention reaction');
  }

  const threadContext = await fetchDiscordThreadContext(
    message.client,
    message.channelId,
    message.id,
  );
  const strippedText = stripDiscordMentions(message.content);
  const requestText =
    strippedText ||
    (threadContext ? 'Please answer based on the thread history.' : '') ||
    'Say hello and ask how you can help.';

  const job: JobSpec = {
    jobId: createJobId('mention'),
    type: 'MENTION',
    repoKeys: [],
    gitRef: defaultGitRef,
    requestText,
    agent: config.primaryAgent,
    channel: buildChannelContext(message),
    ...(threadContext ? { threadContext } : {}),
  };

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist mention job');
    await message.reply('I could not start that request. Please try again.');
    return;
  }

  await enqueueJob(queue, job);
}

export async function startDiscordBot(
  jobQueue: Queue<JobSpec>,
  bootstrapQueue: Queue<BootstrapRequest>,
) {
  const config = loadBotConfig();
  if (!config.discord) {
    throw new Error('Discord is not configured. Set DISCORD_ENABLED=true and required env vars.');
  }

  await registerDiscordCommands(
    config.discord.appId,
    config.discord.botToken,
    config.discord.guildId,
  );

  logger.info('Registered Discord slash commands');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const prefix = toSlackCommandPrefix(config.botName);
  const commandNames = buildCommandNames(prefix);

  client.once(Events.ClientReady, () => {
    logger.info(`🤖 ${config.botName} Discord bot is running`);
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (!isChannelAllowed(config.discord?.channelIds, interaction.channelId)) {
      await interaction.reply({
        content: 'This command is not enabled in this channel.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === commandNames.implement) {
      try {
        await handleImplementStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.ask) {
      try {
        await handleAskStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    if (interaction.commandName === commandNames.bootstrap) {
      try {
        await handleBootstrapStart(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Discord command failed');
        await interaction.reply('Something went wrong handling that command.');
      }
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      if (interaction.commandName === commandNames.usage) {
        await handleUsage(interaction);
      }
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, 'Discord command failed');
      await interaction.editReply('Something went wrong handling that command.');
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === askRepoSelectCustomId) {
      try {
        await handleAskSelection(interaction);
      } catch (err) {
        logger.error({ err }, 'Discord ask selection failed');
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === implementRepoSelectCustomId) {
      try {
        await handleImplementSelection(interaction);
      } catch (err) {
        logger.error({ err }, 'Discord implement selection failed');
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === implementModalCustomId) {
      try {
        await handleImplementModalSubmit(interaction, jobQueue);
      } catch (err) {
        logger.error({ err }, 'Discord implement modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === askModalCustomId) {
      try {
        await handleAskModalSubmit(interaction, jobQueue);
      } catch (err) {
        logger.error({ err }, 'Discord ask modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === bootstrapModalCustomId) {
      try {
        await handleBootstrapModalSubmit(interaction, bootstrapQueue);
      } catch (err) {
        logger.error({ err }, 'Discord bootstrap modal submit failed');
        await interaction.reply('Something went wrong handling that request.');
      }
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.client.user) return;
    if (!isChannelAllowed(config.discord?.channelIds, message.channelId)) return;

    try {
      await handleMention(message, jobQueue);
    } catch (err) {
      logger.error({ err }, 'Discord mention handling failed');
    }
  });

  await client.login(config.discord.botToken);

  return client;
}
