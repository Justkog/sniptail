import type { RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';
import { getRepoProviderDisplayName } from '@sniptail/core/repos/providers.js';
import type { RunActionParamDefinition } from '@sniptail/core/repos/runActions.js';
import type { ModalView } from '@slack/web-api';
import { resolveDefaultBaseBranch } from '../lib/repoBaseBranch.js';

export function buildAskModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
  resumeFromJobId?: string,
) {
  const repoOptions = Object.keys(repoAllowlist).map((key) => ({
    text: { type: 'plain_text' as const, text: key },
    value: key,
  }));
  const defaultRepoOptions = repoOptions.length === 1 ? [repoOptions[0]] : undefined;
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Ask` },
    submit: { type: 'plain_text' as const, text: 'Run' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repos',
        label: { type: 'plain_text' as const, text: 'Repositories' },
        element: {
          type: 'multi_static_select' as const,
          action_id: 'repo_keys',
          placeholder: { type: 'plain_text' as const, text: 'Select repos' },
          options: repoOptions,
          ...(defaultRepoOptions ? { initial_options: defaultRepoOptions } : {}),
        },
      },
      {
        type: 'input' as const,
        block_id: 'branch',
        label: { type: 'plain_text' as const, text: 'Base branch' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'git_ref',
          initial_value: resolveDefaultBaseBranch(repoAllowlist),
        },
      },
      {
        type: 'input' as const,
        block_id: 'question',
        label: { type: 'plain_text' as const, text: 'Question' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'request_text',
          multiline: true,
        },
      },
      {
        type: 'input' as const,
        block_id: 'resume',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Resume from job ID (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'resume_from',
          ...(resumeFromJobId ? { initial_value: resumeFromJobId } : {}),
        },
      },
    ],
  };
}

export function buildPlanModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
  resumeFromJobId?: string,
) {
  const repoOptions = Object.keys(repoAllowlist).map((key) => ({
    text: { type: 'plain_text' as const, text: key },
    value: key,
  }));
  const defaultRepoOptions = repoOptions.length === 1 ? [repoOptions[0]] : undefined;
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Plan` },
    submit: { type: 'plain_text' as const, text: 'Run' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repos',
        label: { type: 'plain_text' as const, text: 'Repositories' },
        element: {
          type: 'multi_static_select' as const,
          action_id: 'repo_keys',
          placeholder: { type: 'plain_text' as const, text: 'Select repos' },
          options: repoOptions,
          ...(defaultRepoOptions ? { initial_options: defaultRepoOptions } : {}),
        },
      },
      {
        type: 'input' as const,
        block_id: 'branch',
        label: { type: 'plain_text' as const, text: 'Base branch' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'git_ref',
          initial_value: resolveDefaultBaseBranch(repoAllowlist),
        },
      },
      {
        type: 'input' as const,
        block_id: 'question',
        label: { type: 'plain_text' as const, text: 'Plan request' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'request_text',
          multiline: true,
        },
      },
      {
        type: 'input' as const,
        block_id: 'resume',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Resume from job ID (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'resume_from',
          ...(resumeFromJobId ? { initial_value: resumeFromJobId } : {}),
        },
      },
    ],
  };
}

export function buildExploreModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
  resumeFromJobId?: string,
) {
  const repoOptions = Object.keys(repoAllowlist).map((key) => ({
    text: { type: 'plain_text' as const, text: key },
    value: key,
  }));
  const defaultRepoOptions = repoOptions.length === 1 ? [repoOptions[0]] : undefined;
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Explore` },
    submit: { type: 'plain_text' as const, text: 'Run' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repos',
        label: { type: 'plain_text' as const, text: 'Repositories' },
        element: {
          type: 'multi_static_select' as const,
          action_id: 'repo_keys',
          placeholder: { type: 'plain_text' as const, text: 'Select repos' },
          options: repoOptions,
          ...(defaultRepoOptions ? { initial_options: defaultRepoOptions } : {}),
        },
      },
      {
        type: 'input' as const,
        block_id: 'branch',
        label: { type: 'plain_text' as const, text: 'Base branch' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'git_ref',
          initial_value: resolveDefaultBaseBranch(repoAllowlist),
        },
      },
      {
        type: 'input' as const,
        block_id: 'question',
        label: { type: 'plain_text' as const, text: 'Explore request' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'request_text',
          multiline: true,
        },
      },
      {
        type: 'input' as const,
        block_id: 'resume',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Resume from job ID (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'resume_from',
          ...(resumeFromJobId ? { initial_value: resumeFromJobId } : {}),
        },
      },
    ],
  };
}

export function buildAnswerQuestionsModal(
  botName: string,
  callbackId: string,
  privateMetadata: string,
  questions: string[],
) {
  const questionLines = questions.length
    ? questions.join('\n')
    : 'No open questions were recorded for this job.';

  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Questions` },
    submit: { type: 'plain_text' as const, text: 'Send' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `*Open questions*\n${questionLines}`,
        },
      },
      {
        type: 'input' as const,
        block_id: 'answers',
        label: { type: 'plain_text' as const, text: 'Your answers' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'answers',
          multiline: true,
        },
      },
    ],
  };
}

export function buildImplementModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
  resumeFromJobId?: string,
) {
  const repoOptions = Object.keys(repoAllowlist).map((key) => ({
    text: { type: 'plain_text' as const, text: key },
    value: key,
  }));
  const defaultRepoOptions = repoOptions.length === 1 ? [repoOptions[0]] : undefined;
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Implement` },
    submit: { type: 'plain_text' as const, text: 'Run' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repos',
        label: { type: 'plain_text' as const, text: 'Repositories' },
        element: {
          type: 'multi_static_select' as const,
          action_id: 'repo_keys',
          placeholder: { type: 'plain_text' as const, text: 'Select repos' },
          options: repoOptions,
          ...(defaultRepoOptions ? { initial_options: defaultRepoOptions } : {}),
        },
      },
      {
        type: 'input' as const,
        block_id: 'branch',
        label: { type: 'plain_text' as const, text: 'Base branch' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'git_ref',
          initial_value: resolveDefaultBaseBranch(repoAllowlist),
        },
      },
      {
        type: 'input' as const,
        block_id: 'change',
        label: { type: 'plain_text' as const, text: 'Change request' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'request_text',
          multiline: true,
        },
      },
      {
        type: 'input' as const,
        block_id: 'reviewers',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Reviewers (GitLab IDs or GitHub usernames)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'reviewers',
        },
      },
      {
        type: 'input' as const,
        block_id: 'labels',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Labels (comma-separated)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'labels',
        },
      },
      {
        type: 'input' as const,
        block_id: 'resume',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Resume from job ID (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'resume_from',
          ...(resumeFromJobId ? { initial_value: resumeFromJobId } : {}),
        },
      },
    ],
  };
}

export function buildRunModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
  actionSelectActionId: string,
  initialRepoKeys?: string[],
  options?: {
    includeRepoSelection?: boolean;
    includeActionSelection?: boolean;
    includeGitRef?: boolean;
    parameters?: RunActionParamDefinition[];
    initialParams?: Record<string, unknown>;
    submitLabel?: string;
    stepTitle?: string;
    selectedActionId?: string;
  },
): ModalView {
  const repoOptions = Object.keys(repoAllowlist).map((key) => ({
    text: { type: 'plain_text' as const, text: key },
    value: key,
  }));
  const initialOptionsFromInput =
    initialRepoKeys
      ?.map((repoKey) => repoOptions.find((option) => option.value === repoKey))
      .filter((value): value is (typeof repoOptions)[number] => Boolean(value)) ?? [];
  const singleRepoDefault = repoOptions.length === 1 ? repoOptions[0] : undefined;
  const defaultRepoOptions =
    initialOptionsFromInput.length > 0
      ? initialOptionsFromInput
      : singleRepoDefault
        ? [singleRepoDefault]
        : undefined;
  const defaultGitRef =
    defaultRepoOptions && defaultRepoOptions.length > 0
      ? resolveDefaultBaseBranch(repoAllowlist, defaultRepoOptions[0]?.value)
      : resolveDefaultBaseBranch(repoAllowlist);

  const includeRepoSelection = options?.includeRepoSelection ?? true;
  const includeActionSelection = options?.includeActionSelection ?? true;
  const includeGitRef = options?.includeGitRef ?? true;
  const parameters = options?.parameters ?? [];
  const initialParams = options?.initialParams ?? {};
  const submitLabel = options?.submitLabel?.trim() || 'Run';
  const stepSuffix = options?.stepTitle?.trim();

  const blocks: ModalView['blocks'] = [];

  if (includeRepoSelection) {
    blocks.push({
      type: 'input' as const,
      block_id: 'repos',
      label: { type: 'plain_text' as const, text: 'Repositories' },
      element: {
        type: 'multi_static_select' as const,
        action_id: 'repo_keys',
        placeholder: { type: 'plain_text' as const, text: 'Select repos' },
        options: repoOptions,
        ...(defaultRepoOptions ? { initial_options: defaultRepoOptions } : {}),
      },
    });
  }

  if (includeGitRef) {
    blocks.push({
      type: 'input' as const,
      block_id: 'branch',
      label: { type: 'plain_text' as const, text: 'Base branch' },
      element: {
        type: 'plain_text_input' as const,
        action_id: 'git_ref',
        initial_value: defaultGitRef,
      },
    });
  }

  if (includeActionSelection) {
    blocks.push({
      type: 'input' as const,
      block_id: 'run_action',
      label: { type: 'plain_text' as const, text: 'Run action' },
      element: {
        type: 'external_select' as const,
        action_id: actionSelectActionId,
        min_query_length: 0,
        placeholder: { type: 'plain_text' as const, text: 'Select run action' },
        ...(options?.selectedActionId
          ? {
              initial_option: {
                text: { type: 'plain_text' as const, text: options.selectedActionId },
                value: options.selectedActionId,
              },
            }
          : {}),
      },
    });
  }

  for (const parameter of parameters) {
    const value = initialParams[parameter.id] ?? parameter.default;
    const initialValue =
      value === undefined
        ? undefined
        : Array.isArray(value)
          ? value.join(', ')
          : typeof value === 'string'
            ? value
            : typeof value === 'number' || typeof value === 'boolean'
              ? `${value}`
              : undefined;
    const multiline = parameter.uiMode === 'textarea';
    const placeholder =
      parameter.uiMode === 'multiselect' || parameter.type === 'string[]'
        ? 'Comma-separated values'
        : parameter.uiMode === 'boolean' || parameter.type === 'boolean'
          ? 'true or false'
          : parameter.type === 'number'
            ? 'Numeric value'
            : parameter.description;
    blocks.push({
      type: 'input' as const,
      block_id: `run_param_${parameter.id}`,
      optional: !parameter.required,
      label: { type: 'plain_text' as const, text: parameter.label.slice(0, 24) },
      ...(parameter.description
        ? {
            hint: {
              type: 'plain_text' as const,
              text: parameter.description.slice(0, 120),
            },
          }
        : {}),
      element: {
        type: 'plain_text_input' as const,
        action_id: `run_param_${parameter.id}`,
        ...(multiline ? { multiline: true } : {}),
        ...(initialValue?.trim() ? { initial_value: initialValue.slice(0, 3000) } : {}),
        ...(placeholder?.trim()
          ? {
              placeholder: {
                type: 'plain_text' as const,
                text: placeholder.slice(0, 120),
              },
            }
          : {}),
      },
    });
  }

  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: {
      type: 'plain_text' as const,
      text: stepSuffix ? `${botName} ${stepSuffix}` : `${botName} Run`,
    },
    submit: { type: 'plain_text' as const, text: submitLabel.slice(0, 24) },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks,
  };
}

export function buildRepoBootstrapModal(
  services: RepoBootstrapService[],
  botName: string,
  callbackId: string,
  privateMetadata: string,
  localRepoRoot?: string,
) {
  const serviceOptions = services.map((service) => ({
    text: {
      type: 'plain_text' as const,
      text: getRepoProviderDisplayName(service),
    },
    value: service,
  }));
  const defaultService = serviceOptions.length === 1 ? serviceOptions[0] : undefined;
  const localRepoRootHint = localRepoRoot?.trim() || '';
  const localPathLabel = localRepoRootHint
    ? `Local directory path (relative to ${localRepoRootHint})`
    : 'Local directory path';
  const localPathPlaceholder = localRepoRootHint ? 'team/my-repo' : '/srv/repos/my-repo';
  const localPathHint = localRepoRootHint
    ? `Local only. Path will be created under ${localRepoRootHint}.`
    : 'Local only. Provide an absolute or relative path.';
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Bootstrap` },
    submit: { type: 'plain_text' as const, text: 'Create' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repo_name',
        label: { type: 'plain_text' as const, text: 'Repository name' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'repo_name',
          placeholder: { type: 'plain_text' as const, text: 'my-new-repo' },
        },
      },
      {
        type: 'input' as const,
        block_id: 'repo_key',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Allowlist key (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'repo_key',
          placeholder: { type: 'plain_text' as const, text: 'Defaults to repository name' },
        },
      },
      {
        type: 'input' as const,
        block_id: 'service',
        label: { type: 'plain_text' as const, text: 'Repository service' },
        element: {
          type: 'static_select' as const,
          action_id: 'service',
          placeholder: { type: 'plain_text' as const, text: 'Choose a service' },
          options: serviceOptions,
          ...(defaultService ? { initial_option: defaultService } : {}),
        },
      },
      {
        type: 'input' as const,
        block_id: 'local_path',
        optional: true,
        label: { type: 'plain_text' as const, text: localPathLabel },
        hint: { type: 'plain_text' as const, text: localPathHint },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'local_path',
          placeholder: { type: 'plain_text' as const, text: localPathPlaceholder },
        },
      },
      {
        type: 'input' as const,
        block_id: 'owner',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Owner/namespace (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'owner',
          placeholder: {
            type: 'plain_text' as const,
            text: 'GitHub org/user or GitLab group path',
          },
        },
      },
      {
        type: 'input' as const,
        block_id: 'gitlab_namespace_id',
        optional: true,
        label: { type: 'plain_text' as const, text: 'GitLab namespace ID (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'gitlab_namespace_id',
          placeholder: { type: 'plain_text' as const, text: 'Numeric namespace id' },
        },
      },
      {
        type: 'input' as const,
        block_id: 'description',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Description (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'description',
        },
      },
      {
        type: 'input' as const,
        block_id: 'visibility',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Visibility (optional)' },
        element: {
          type: 'static_select' as const,
          action_id: 'visibility',
          placeholder: { type: 'plain_text' as const, text: 'Private (default)' },
          options: [
            { text: { type: 'plain_text' as const, text: 'Private' }, value: 'private' },
            { text: { type: 'plain_text' as const, text: 'Public' }, value: 'public' },
          ],
        },
      },
      {
        type: 'input' as const,
        block_id: 'quickstart',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Quickstart' },
        element: {
          type: 'checkboxes' as const,
          action_id: 'quickstart',
          options: [
            {
              text: { type: 'plain_text' as const, text: 'Initialize with README' },
              value: 'readme',
            },
          ],
        },
      },
    ],
  };
}

export function buildRepoAddAdminModal(
  botName: string,
  callbackId: string,
  privateMetadata: string,
  localRepoRoot?: string,
) {
  const localRepoRootHint = localRepoRoot?.trim() || '';
  const localPathLabel = 'Local directory path on worker';
  const localPathPlaceholder = localRepoRootHint || '/srv/repos/my-repo';
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Repo Add` },
    submit: { type: 'plain_text' as const, text: 'Add' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repo_key',
        label: { type: 'plain_text' as const, text: 'Repository key' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'repo_key',
          placeholder: { type: 'plain_text' as const, text: 'my-repo' },
        },
      },
      {
        type: 'input' as const,
        block_id: 'provider',
        label: { type: 'plain_text' as const, text: 'Repository provider' },
        element: {
          type: 'static_select' as const,
          action_id: 'provider',
          placeholder: { type: 'plain_text' as const, text: 'Choose a provider' },
          options: [
            { text: { type: 'plain_text' as const, text: 'GitHub' }, value: 'github' },
            { text: { type: 'plain_text' as const, text: 'GitLab' }, value: 'gitlab' },
            { text: { type: 'plain_text' as const, text: 'Local' }, value: 'local' },
          ],
        },
      },
      {
        type: 'input' as const,
        block_id: 'ssh_url',
        optional: true,
        label: { type: 'plain_text' as const, text: 'SSH URL (GitHub/GitLab)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'ssh_url',
          placeholder: { type: 'plain_text' as const, text: 'git@github.com:org/my-repo.git' },
        },
      },
      {
        type: 'input' as const,
        block_id: 'local_path',
        optional: true,
        label: { type: 'plain_text' as const, text: localPathLabel },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'local_path',
          placeholder: { type: 'plain_text' as const, text: localPathPlaceholder },
        },
      },
      {
        type: 'input' as const,
        block_id: 'project_id',
        optional: true,
        label: {
          type: 'plain_text' as const,
          text: 'GitLab project ID (required for GitLab repositories)',
        },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'project_id',
          placeholder: {
            type: 'plain_text' as const,
            text: 'Required when provider is GitLab, e.g., 12345',
          },
        },
      },
      {
        type: 'input' as const,
        block_id: 'base_branch',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Base branch (optional)' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'base_branch',
          placeholder: { type: 'plain_text' as const, text: 'main' },
        },
      },
    ],
  };
}

export function buildRepoRemoveAdminModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
) {
  const repoOptions = Object.keys(repoAllowlist).map((key) => ({
    text: { type: 'plain_text' as const, text: key },
    value: key,
  }));
  const defaultRepoOption = repoOptions.length === 1 ? repoOptions[0] : undefined;
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: `${botName} Repo Remove` },
    submit: { type: 'plain_text' as const, text: 'Remove' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'repo_key',
        label: { type: 'plain_text' as const, text: 'Repository key' },
        element: {
          type: 'static_select' as const,
          action_id: 'repo_key',
          placeholder: { type: 'plain_text' as const, text: 'Choose a repo key' },
          options: repoOptions,
          ...(defaultRepoOption ? { initial_option: defaultRepoOption } : {}),
        },
      },
    ],
  };
}
