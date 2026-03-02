import type { BotConfig } from '@sniptail/core/config/config.js';
import {
  normalizeRunActionParams,
  resolveRunActionMetadataForRepos,
  type RepoRunActionMetadata,
  type RunActionParamDefinition,
  type RunActionParamValue,
  type RunActionStepDefinition,
} from '@sniptail/core/repos/runActions.js';

export type ResolvedRunStep = {
  step: RunActionStepDefinition;
  parameters: RunActionParamDefinition[];
};

function getDefinitionsById(
  metadata: RepoRunActionMetadata,
): Map<string, RunActionParamDefinition> {
  return new Map(metadata.parameters.map((parameter) => [parameter.id, parameter]));
}

export function resolveRunActionMetadata(
  config: BotConfig,
  repoKeys: string[],
  actionId: string,
): RepoRunActionMetadata {
  const providerData = repoKeys.map((repoKey) => {
    const repo = config.repoAllowlist[repoKey];
    return repo?.providerData;
  });
  return resolveRunActionMetadataForRepos(actionId, providerData);
}

export function resolveRunStep(
  metadata: RepoRunActionMetadata,
  stepIndex: number,
): ResolvedRunStep | undefined {
  const step = metadata.steps[stepIndex];
  if (!step) {
    return undefined;
  }
  const byId = getDefinitionsById(metadata);
  const parameters = step.fields
    .map((field) => byId.get(field))
    .filter((value): value is RunActionParamDefinition => Boolean(value));
  return {
    step,
    parameters,
  };
}

export function normalizeCollectedRunParams(
  metadata: RepoRunActionMetadata,
  params: Record<string, unknown>,
): {
  normalized: Record<string, RunActionParamValue>;
  sensitiveValues: string[];
} {
  return normalizeRunActionParams(params, metadata);
}
