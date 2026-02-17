import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';
import { getRepoProviderDisplayName } from '@sniptail/core/repos/providers.js';

export const askRepoSelectCustomId = 'ask_repo_select';
export const askModalCustomId = 'ask_modal';
export const planRepoSelectCustomId = 'plan_repo_select';
export const planModalCustomId = 'plan_modal';
export const answerQuestionsModalCustomId = 'answer_questions_modal';
export const implementRepoSelectCustomId = 'implement_repo_select';
export const implementModalCustomId = 'implement_modal';
export const bootstrapModalCustomId = 'bootstrap_modal';
export const bootstrapVisibilitySelectCustomId = 'bootstrap_visibility_select';
export const bootstrapQuickstartSelectCustomId = 'bootstrap_quickstart_select';
export const bootstrapServiceSelectCustomId = 'bootstrap_service_select';
export const bootstrapContinueButtonCustomId = 'bootstrap_continue';

export type BootstrapExtrasSelection = {
  service: RepoBootstrapService;
  visibility: 'private' | 'public';
  quickstart: boolean;
};

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

export function buildPlanRepoSelect(repoKeys: string[]) {
  const options = repoKeys.map((key) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(key)
      .setValue(key)
      .setDefault(repoKeys.length === 1),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(planRepoSelectCustomId)
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

export function buildPlanModal(
  botName: string,
  repoKeys: string[],
  baseBranch: string,
  resumeFromJobId?: string,
) {
  const modal = new ModalBuilder().setCustomId(planModalCustomId).setTitle(`${botName} Plan`);

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
    new LabelBuilder().setLabel('Plan request').setTextInputComponent(questionInput),
    new LabelBuilder().setLabel('Resume from job ID (optional)').setTextInputComponent(resumeInput),
  );

  if (repoKeys.length > 1) {
    modal.setTitle(`${botName} Plan (${repoKeys.length} repos)`);
  }

  return modal;
}

export function buildAnswerQuestionsModal(botName: string, openQuestions: string[]) {
  const modal = new ModalBuilder()
    .setCustomId(answerQuestionsModalCustomId)
    .setTitle(`${botName} Questions`);

  const questionsInput = new TextInputBuilder()
    .setCustomId('questions')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(
      openQuestions.length
        ? openQuestions.join('\n')
        : 'No open questions were recorded for this job.',
    )
    .setRequired(false);

  const answersInput = new TextInputBuilder()
    .setCustomId('answers')
    .setStyle(TextInputStyle.Paragraph);

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Open questions').setTextInputComponent(questionsInput),
    new LabelBuilder().setLabel('Your answers').setTextInputComponent(answersInput),
  );

  return modal;
}

export function buildBootstrapModal(botName: string) {
  const modal = new ModalBuilder()
    .setCustomId(bootstrapModalCustomId)
    .setTitle(`${botName} Bootstrap`);

  const repoNameInput = new TextInputBuilder()
    .setCustomId('repo_name')
    .setStyle(TextInputStyle.Short);

  const repoKeyInput = new TextInputBuilder()
    .setCustomId('repo_key')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const ownerInput = new TextInputBuilder()
    .setCustomId('owner')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  const extrasInput = new TextInputBuilder()
    .setCustomId('extras')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Repository name').setTextInputComponent(repoNameInput),
    new LabelBuilder().setLabel('Allowlist key (optional)').setTextInputComponent(repoKeyInput),
    new LabelBuilder().setLabel('Owner/namespace (optional)').setTextInputComponent(ownerInput),
    new LabelBuilder().setLabel('Description (optional)').setTextInputComponent(descriptionInput),
    new LabelBuilder()
      .setLabel('Extras (optional)')
      .setDescription('gitlab_namespace_id=123, local_path=path')
      .setTextInputComponent(extrasInput),
  );

  return modal;
}

export function buildBootstrapExtrasPrompt(
  botName: string,
  selection: BootstrapExtrasSelection,
  services: RepoBootstrapService[],
) {
  const serviceSelect = new StringSelectMenuBuilder()
    .setCustomId(bootstrapServiceSelectCustomId)
    .setPlaceholder('Select service')
    .addOptions(
      services.map((service) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`Service: ${getRepoProviderDisplayName(service)}`)
          .setValue(service)
          .setDefault(selection.service === service),
      ),
    );

  const visibilitySelect = new StringSelectMenuBuilder()
    .setCustomId(bootstrapVisibilitySelectCustomId)
    .setPlaceholder('Select visibility')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Visibility: private')
        .setValue('private')
        .setDefault(selection.visibility === 'private'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Visibility: public')
        .setValue('public')
        .setDefault(selection.visibility === 'public'),
    );

  const quickstartSelect = new StringSelectMenuBuilder()
    .setCustomId(bootstrapQuickstartSelectCustomId)
    .setPlaceholder('Select quickstart')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Quickstart: false')
        .setValue('false')
        .setDefault(!selection.quickstart),
      new StringSelectMenuOptionBuilder()
        .setLabel('Quickstart: true')
        .setValue('true')
        .setDefault(selection.quickstart),
    );

  const continueButton = new ButtonBuilder()
    .setCustomId(bootstrapContinueButtonCustomId)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Continue');

  return {
    content: `${botName} bootstrap options`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(serviceSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(visibilitySelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(quickstartSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton),
    ],
  };
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
