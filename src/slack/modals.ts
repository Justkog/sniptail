import type { RepoConfig } from '../types/job.js';

export function buildAskModal(
  repoAllowlist: Record<string, RepoConfig>,
  botName: string,
  callbackId: string,
  privateMetadata: string,
  resumeFromJobId?: string,
) {
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
          options: Object.keys(repoAllowlist).map((key) => ({
            text: { type: 'plain_text' as const, text: key },
            value: key,
          })),
        },
      },
      {
        type: 'input' as const,
        block_id: 'branch',
        label: { type: 'plain_text' as const, text: 'Base branch' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'git_ref',
          initial_value: 'experimental',
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
          options: Object.keys(repoAllowlist).map((key) => ({
            text: { type: 'plain_text' as const, text: key },
            value: key,
          })),
        },
      },
      {
        type: 'input' as const,
        block_id: 'branch',
        label: { type: 'plain_text' as const, text: 'Base branch' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'git_ref',
          initial_value: 'experimental',
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
        label: { type: 'plain_text' as const, text: 'Reviewers (comma-separated GitLab user IDs)' },
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
