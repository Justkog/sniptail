import {
  ActionRowBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const askRepoSelectCustomId = 'ask_repo_select';
export const askModalCustomId = 'ask_modal';
export const implementRepoSelectCustomId = 'implement_repo_select';
export const implementModalCustomId = 'implement_modal';
export const bootstrapModalCustomId = 'bootstrap_modal';

export function buildImplementRepoSelect(repoKeys: string[]) {
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

export function buildAskRepoSelect(repoKeys: string[]) {
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

export function buildAskModal(
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

export function buildBootstrapModal(botName: string) {
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

export function buildImplementModal(
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
