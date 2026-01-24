import type { RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';

export function resolveDefaultBaseBranch(
  repoAllowlist: Record<string, RepoConfig>,
  repoKey?: string,
): string {
  if (repoKey) {
    const branch = repoAllowlist[repoKey]?.baseBranch?.trim();
    if (branch) {
      return branch;
    }
  }
  const branches = new Set<string>();
  for (const repo of Object.values(repoAllowlist)) {
    const branch = repo.baseBranch?.trim();
    if (branch) {
      branches.add(branch);
    }
  }
  if (branches.size === 1) {
    return Array.from(branches)[0]!;
  }
  return 'staging';
}

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
      text: service === 'github' ? 'GitHub' : service === 'gitlab' ? 'GitLab' : 'Local',
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
