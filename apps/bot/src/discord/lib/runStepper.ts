import type { BotConfig } from '@sniptail/core/config/config.js';
import type { ModalSubmitFields } from 'discord.js';
import type {
  RunActionParamDefinition,
  RunActionParamValue,
  RepoRunActionMetadata,
} from '@sniptail/core/repos/runActions.js';
import {
  normalizeCollectedRunParams as normalizeParams,
  resolveRunActionMetadata,
  resolveRunStep,
} from '../../lib/runActionParams.js';
import { resolveDefaultBaseBranch } from '../../lib/repoBaseBranch.js';
import { buildRunModal } from '../modals.js';

export type RunSelectionState = {
  repoKeys: string[];
  actionId: string;
  runStepIndex: number;
  collectedParams: Record<string, unknown>;
  gitRef?: string;
};

export function resolveRunSelectionSchema(
  config: BotConfig,
  selection: Pick<RunSelectionState, 'repoKeys' | 'actionId'>,
): RepoRunActionMetadata {
  return resolveRunActionMetadata(config, selection.repoKeys, selection.actionId);
}

export function buildRunStepModal(options: { config: BotConfig; selection: RunSelectionState }) {
  const { config, selection } = options;
  const metadata = resolveRunSelectionSchema(config, selection);
  const stepCount = metadata.steps.length;
  const currentStep = resolveRunStep(metadata, selection.runStepIndex);
  if (stepCount > 0 && !currentStep) {
    throw new Error('Run parameter selection expired. Please restart the run command.');
  }

  const includeGitRef = selection.runStepIndex === 0;
  const baseBranch = selection.gitRef
    ? selection.gitRef
    : resolveDefaultBaseBranch(config.repoAllowlist, selection.repoKeys[0]);
  const parameters = currentStep?.parameters ?? [];
  const stepTitle = stepCount > 0 ? `${selection.runStepIndex + 1}/${stepCount}` : undefined;

  return {
    metadata,
    modal: buildRunModal(config.botName, selection.repoKeys, baseBranch, {
      parameters,
      initialValues: selection.collectedParams,
      includeGitRef,
      ...(stepTitle ? { stepTitle } : {}),
    }),
  };
}

function parseRunFieldValue(raw: string, parameter: RunActionParamDefinition): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (parameter.uiMode === 'multiselect' || parameter.type === 'string[]') {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (parameter.uiMode === 'boolean' || parameter.type === 'boolean') {
    return trimmed;
  }
  if (parameter.type === 'number') {
    return trimmed;
  }
  return raw;
}

export function collectRunStepParams(
  fields: ModalSubmitFields,
  parameters: RunActionParamDefinition[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const parameter of parameters) {
    const customId = `run_param_${parameter.id}`;
    let raw = '';
    try {
      raw = fields.getTextInputValue(customId);
    } catch {
      raw = '';
    }
    const parsed = parseRunFieldValue(raw, parameter);
    if (parsed !== undefined) {
      values[parameter.id] = parsed;
    }
  }
  return values;
}

export function toRunParamPayload(
  values: Record<string, unknown>,
): Record<string, RunActionParamValue> {
  return values as Record<string, RunActionParamValue>;
}

export function normalizeCollectedRunParams(
  metadata: RepoRunActionMetadata,
  params: Record<string, unknown>,
) {
  return normalizeParams(metadata, params);
}
