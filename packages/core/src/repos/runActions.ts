const RUN_ACTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const RUN_PARAM_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export const RUN_PARAM_UI_MODES = [
  'auto',
  'text',
  'textarea',
  'select',
  'multiselect',
  'boolean',
  'number',
  'secret',
] as const;

export const RUN_PARAM_TYPES = ['string', 'number', 'boolean', 'string[]'] as const;

export type RunParamUiMode = (typeof RUN_PARAM_UI_MODES)[number];
export type RunParamType = (typeof RUN_PARAM_TYPES)[number];

export type RunActionParamDefinition = {
  id: string;
  label: string;
  type: RunParamType;
  uiMode: RunParamUiMode;
  required: boolean;
  description?: string;
  options?: string[];
  default?: string | number | boolean | string[];
  min?: number;
  max?: number;
  sensitive: boolean;
};

export type RunActionStepDefinition = {
  id: string;
  title?: string;
  fields: string[];
};

export type RunActionParamValue = string | number | boolean | string[];

export type RepoRunActionMetadata = {
  parameters: RunActionParamDefinition[];
  steps: RunActionStepDefinition[];
};

export type RepoRunActionsMetadata = {
  actions: Record<string, RepoRunActionMetadata>;
  syncedAt: string;
  sourceRef: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeRunParamId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!RUN_PARAM_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid run parameter id "${value}".`);
  }
  return normalized;
}

function normalizeRunParamType(value: unknown): RunParamType {
  if (typeof value !== 'string') {
    throw new Error('Run parameter type must be a string.');
  }
  const normalized = value.trim().toLowerCase() as RunParamType;
  if (!RUN_PARAM_TYPES.includes(normalized)) {
    throw new Error(`Invalid run parameter type "${value}".`);
  }
  return normalized;
}

function normalizeRunParamUiMode(value: unknown): RunParamUiMode {
  if (typeof value !== 'string') {
    throw new Error('Run parameter ui_mode must be a string.');
  }
  const normalized = value.trim().toLowerCase() as RunParamUiMode;
  if (!RUN_PARAM_UI_MODES.includes(normalized)) {
    throw new Error(`Invalid run parameter ui_mode "${value}".`);
  }
  return normalized;
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings.`);
  }
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  if (strings.length !== value.length) {
    throw new Error(`${name} must be an array of strings.`);
  }
  const normalized = strings.map((entry) => entry.trim()).filter(Boolean);
  if (!normalized.length) {
    throw new Error(`${name} must contain at least one non-empty value.`);
  }
  return Array.from(new Set(normalized));
}

function normalizeParamDefault(
  value: unknown,
  param: Pick<RunActionParamDefinition, 'id' | 'type'>,
): RunActionParamDefinition['default'] {
  if (value === undefined) {
    return undefined;
  }

  if (param.type === 'string') {
    if (typeof value !== 'string') {
      throw new Error(`Default for run parameter "${param.id}" must be a string.`);
    }
    return value;
  }
  if (param.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Default for run parameter "${param.id}" must be a number.`);
    }
    return value;
  }
  if (param.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Default for run parameter "${param.id}" must be a boolean.`);
    }
    return value;
  }
  return normalizeStringArray(value, `run parameter ${param.id} default`);
}

function normalizeRunActionParamDefinition(value: unknown): RunActionParamDefinition {
  const table = asRecord(value);
  if (!table) {
    throw new Error('Run parameter entry must be a table.');
  }

  const idRaw = table.id;
  if (typeof idRaw !== 'string') {
    throw new Error('Run parameter id must be a string.');
  }
  const id = normalizeRunParamId(idRaw);

  const labelRaw = table.label;
  if (typeof labelRaw !== 'string' || !labelRaw.trim()) {
    throw new Error(`Run parameter "${id}" label must be a non-empty string.`);
  }
  const label = labelRaw.trim();

  const type = normalizeRunParamType(table.type);
  const uiModeRaw = table.uiMode ?? table.ui_mode;
  const uiMode = uiModeRaw === undefined ? 'auto' : normalizeRunParamUiMode(uiModeRaw);
  if (table.required !== undefined && typeof table.required !== 'boolean') {
    throw new Error(`Run parameter "${id}" required must be a boolean.`);
  }
  const required = table.required === undefined ? false : table.required;
  if (table.sensitive !== undefined && typeof table.sensitive !== 'boolean') {
    throw new Error(`Run parameter "${id}" sensitive must be a boolean.`);
  }
  const sensitive = table.sensitive === undefined ? uiMode === 'secret' : table.sensitive;
  const description =
    typeof table.description === 'string' && table.description.trim()
      ? table.description.trim()
      : undefined;

  const options =
    table.options === undefined
      ? undefined
      : normalizeStringArray(table.options, `run parameter ${id} options`);
  if (
    (uiMode === 'select' || uiMode === 'multiselect' || type === 'string[]') &&
    !options?.length
  ) {
    throw new Error(`Run parameter "${id}" requires options.`);
  }

  const min = typeof table.min === 'number' && Number.isFinite(table.min) ? table.min : undefined;
  const max = typeof table.max === 'number' && Number.isFinite(table.max) ? table.max : undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`Run parameter "${id}" has min greater than max.`);
  }

  const normalized: RunActionParamDefinition = {
    id,
    label,
    type,
    uiMode,
    required,
    sensitive,
    ...(description ? { description } : {}),
    ...(options?.length ? { options } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
  const defaultValue = normalizeParamDefault(table.default, normalized);
  return {
    ...normalized,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

function normalizeRunActionParameters(values: unknown): RunActionParamDefinition[] {
  if (values === undefined) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error('Run action parameters must be an array.');
  }

  const parameters = values.map((entry) => normalizeRunActionParamDefinition(entry));
  const unique = new Map<string, RunActionParamDefinition>();
  for (const parameter of parameters) {
    if (unique.has(parameter.id)) {
      throw new Error(`Duplicate run parameter id "${parameter.id}".`);
    }
    unique.set(parameter.id, parameter);
  }
  return Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeRunActionStepDefinition(
  value: unknown,
  parameterIds: Set<string>,
): RunActionStepDefinition {
  const table = asRecord(value);
  if (!table) {
    throw new Error('Run step entry must be a table.');
  }
  const idRaw = table.id;
  if (typeof idRaw !== 'string' || !idRaw.trim()) {
    throw new Error('Run step id must be a non-empty string.');
  }
  const id = idRaw.trim();
  const title =
    typeof table.title === 'string' && table.title.trim() ? table.title.trim() : undefined;
  const fields = normalizeStringArray(table.fields, `run step ${id} fields`).map((field) =>
    normalizeRunParamId(field),
  );
  for (const field of fields) {
    if (!parameterIds.has(field)) {
      throw new Error(`Run step "${id}" references unknown parameter "${field}".`);
    }
  }
  return {
    id,
    ...(title ? { title } : {}),
    fields,
  };
}

function normalizeRunActionSteps(
  values: unknown,
  parameters: RunActionParamDefinition[],
): RunActionStepDefinition[] {
  if (values === undefined) {
    if (!parameters.length) {
      return [];
    }
    return [{ id: 'main', fields: parameters.map((parameter) => parameter.id) }];
  }
  if (!Array.isArray(values)) {
    throw new Error('Run action steps must be an array.');
  }

  const parameterIds = new Set(parameters.map((parameter) => parameter.id));
  const normalized = values.map((value) => normalizeRunActionStepDefinition(value, parameterIds));
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const step of normalized) {
    if (seen.has(step.id)) {
      throw new Error(`Duplicate run step id "${step.id}".`);
    }
    seen.add(step.id);
    for (const field of step.fields) {
      covered.add(field);
    }
  }

  const missingFields = parameters
    .map((parameter) => parameter.id)
    .filter((id) => !covered.has(id));
  if (missingFields.length) {
    throw new Error(
      `Run step definitions must include every parameter. Missing: ${missingFields.join(', ')}.`,
    );
  }
  return normalized;
}

function normalizeRepoRunActionMetadata(value: unknown): RepoRunActionMetadata {
  const table = asRecord(value);
  if (!table) {
    throw new Error('Run action metadata entry must be a table.');
  }
  const parameters = normalizeRunActionParameters(table.parameters);
  const steps = normalizeRunActionSteps(table.steps, parameters);
  return { parameters, steps };
}

function normalizeRunActions(
  actions: Record<string, unknown>,
): Record<string, RepoRunActionMetadata> {
  const normalizedEntries: Array<[string, RepoRunActionMetadata]> = [];
  for (const [rawActionId, actionValue] of Object.entries(actions)) {
    const actionId = normalizeRunActionId(rawActionId);
    normalizedEntries.push([actionId, normalizeRepoRunActionMetadata(actionValue)]);
  }
  normalizedEntries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(normalizedEntries);
}

function normalizeOptionValue(value: string): string {
  return value.trim();
}

function normalizeBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return undefined;
}

function normalizeNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeStringArrayValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const allStrings = value.filter((entry): entry is string => typeof entry === 'string');
    if (allStrings.length !== value.length) {
      return undefined;
    }
    return allStrings.map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

function normalizeDefaultForType(
  value: RunActionParamDefinition['default'],
  type: RunParamType,
): RunActionParamValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (type === 'string') {
    return typeof value === 'string' ? value : undefined;
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  return Array.isArray(value) ? value.map((entry) => entry.trim()).filter(Boolean) : undefined;
}

function isSameDefault(
  left: RunActionParamDefinition['default'],
  right: RunActionParamDefinition['default'],
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function intersectOptions(optionSets: string[][]): string[] {
  if (!optionSets.length) {
    return [];
  }
  let intersection = new Set(optionSets[0]?.map(normalizeOptionValue) ?? []);
  for (const options of optionSets.slice(1)) {
    const current = new Set(options.map(normalizeOptionValue));
    intersection = new Set(Array.from(intersection).filter((value) => current.has(value)));
  }
  return Array.from(intersection).sort((a, b) => a.localeCompare(b));
}

function normalizeParamValueByDefinition(
  value: unknown,
  definition: RunActionParamDefinition,
): RunActionParamValue | undefined {
  if (definition.type === 'string') {
    return typeof value === 'string' ? value : undefined;
  }
  if (definition.type === 'number') {
    return normalizeNumberValue(value);
  }
  if (definition.type === 'boolean') {
    return normalizeBooleanValue(value);
  }
  return normalizeStringArrayValue(value);
}

export function normalizeRunActionId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Run action id cannot be empty.');
  }
  if (!RUN_ACTION_ID_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid run action id "${value}". Use lowercase letters, numbers, dot, underscore, or dash.`,
    );
  }
  return normalized;
}

export function tryNormalizeRunActionId(value: string): string | undefined {
  try {
    return normalizeRunActionId(value);
  } catch {
    return undefined;
  }
}

export function isValidRunActionId(value: string): boolean {
  return Boolean(tryNormalizeRunActionId(value));
}

export function listRunActionIds(providerData?: Record<string, unknown>): string[] {
  const metadata = getRepoRunActionsMetadata(providerData);
  return Object.keys(metadata?.actions ?? {});
}

export function getRepoRunActionMetadata(
  providerData: Record<string, unknown> | undefined,
  actionId: string,
): RepoRunActionMetadata | undefined {
  const metadata = getRepoRunActionsMetadata(providerData);
  const normalizedActionId = tryNormalizeRunActionId(actionId);
  if (!metadata || !normalizedActionId) {
    return undefined;
  }
  return metadata.actions[normalizedActionId];
}

export function getRepoRunActionsMetadata(
  providerData?: Record<string, unknown>,
): RepoRunActionsMetadata | undefined {
  if (!providerData) return undefined;
  const sniptail = asRecord(providerData.sniptail);
  const run = asRecord(sniptail?.run);
  if (!run) return undefined;

  const actionsRaw = asRecord(run.actions);
  if (!actionsRaw) return undefined;

  const syncedAt = typeof run.syncedAt === 'string' ? run.syncedAt.trim() : '';
  const sourceRef = typeof run.sourceRef === 'string' ? run.sourceRef.trim() : '';
  if (!syncedAt || !sourceRef) return undefined;

  let actions: Record<string, RepoRunActionMetadata>;
  try {
    actions = normalizeRunActions(actionsRaw);
  } catch {
    return undefined;
  }
  if (!Object.keys(actions).length) return undefined;

  return {
    actions,
    syncedAt,
    sourceRef,
  };
}

export function withRepoRunActionsMetadata(
  providerData: Record<string, unknown> | undefined,
  metadata: RepoRunActionsMetadata,
): Record<string, unknown> {
  const normalizedActions = normalizeRunActions(metadata.actions);
  const base = providerData ? { ...providerData } : {};
  const sniptail = asRecord(base.sniptail) ?? {};
  return {
    ...base,
    sniptail: {
      ...sniptail,
      run: {
        actions: normalizedActions,
        syncedAt: metadata.syncedAt,
        sourceRef: metadata.sourceRef,
      },
    },
  };
}

export function resolveRunActionMetadataForRepos(
  actionId: string,
  repoProviderData: Array<Record<string, unknown> | undefined>,
): RepoRunActionMetadata {
  const normalizedActionId = normalizeRunActionId(actionId);
  if (!repoProviderData.length) {
    throw new Error('Cannot resolve run action schema without repositories.');
  }

  const actionMetadataByRepo = repoProviderData.map((providerData, index) => {
    const metadata = getRepoRunActionMetadata(providerData, normalizedActionId);
    if (!metadata) {
      throw new Error(
        `Run action "${normalizedActionId}" is missing metadata for selected repo at index ${index}.`,
      );
    }
    return metadata;
  });

  const paramIdSets = actionMetadataByRepo.map((metadata) =>
    metadata.parameters.map((param) => param.id),
  );
  let commonParamIds = new Set(paramIdSets[0] ?? []);
  for (const paramIds of paramIdSets.slice(1)) {
    const current = new Set(paramIds);
    commonParamIds = new Set(Array.from(commonParamIds).filter((id) => current.has(id)));
  }

  for (const metadata of actionMetadataByRepo) {
    const missingRequired = metadata.parameters
      .filter((param) => param.required)
      .map((param) => param.id)
      .filter((paramId) => !commonParamIds.has(paramId));
    if (missingRequired.length) {
      throw new Error(
        `Run action "${normalizedActionId}" has required params not shared across repos: ${missingRequired.join(', ')}.`,
      );
    }
  }

  const commonIds = Array.from(commonParamIds).sort((a, b) => a.localeCompare(b));
  const mergedParameters = commonIds.map((paramId) => {
    const defs = actionMetadataByRepo
      .map((metadata) => metadata.parameters.find((param) => param.id === paramId))
      .filter((value): value is RunActionParamDefinition => Boolean(value));

    const first = defs[0];
    if (!first) {
      throw new Error(`Unable to resolve run param "${paramId}".`);
    }
    if (defs.some((def) => def.type !== first.type)) {
      throw new Error(
        `Run action "${normalizedActionId}" has conflicting type for param "${paramId}".`,
      );
    }

    const options = defs.some((def) => def.options?.length)
      ? intersectOptions(defs.map((def) => def.options ?? []))
      : undefined;
    if (defs.some((def) => def.options?.length) && !options?.length) {
      throw new Error(
        `Run action "${normalizedActionId}" has no common options for param "${paramId}".`,
      );
    }

    const minCandidates = defs
      .map((def) => def.min)
      .filter((value): value is number => value !== undefined);
    const maxCandidates = defs
      .map((def) => def.max)
      .filter((value): value is number => value !== undefined);
    const min = minCandidates.length ? Math.max(...minCandidates) : undefined;
    const max = maxCandidates.length ? Math.min(...maxCandidates) : undefined;
    if (min !== undefined && max !== undefined && min > max) {
      throw new Error(
        `Run action "${normalizedActionId}" has incompatible bounds for param "${paramId}".`,
      );
    }

    const hasUniformDefault = defs.every((def) => isSameDefault(def.default, first.default));
    const resolvedDefault = hasUniformDefault
      ? normalizeDefaultForType(first.default, first.type)
      : undefined;
    const description = defs.map((def) => def.description).find((value) => Boolean(value));

    return {
      id: paramId,
      label: defs.map((def) => def.label).find(Boolean) ?? first.label,
      type: first.type,
      uiMode: first.uiMode,
      required: defs.some((def) => def.required),
      sensitive: defs.some((def) => def.sensitive),
      ...(description ? { description } : {}),
      ...(options?.length ? { options } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(resolvedDefault !== undefined ? { default: resolvedDefault } : {}),
    } satisfies RunActionParamDefinition;
  });

  const canonicalSteps = actionMetadataByRepo[0]?.steps ?? [];
  const filteredSteps = canonicalSteps
    .map((step) => ({
      ...step,
      fields: step.fields.filter((field) => commonParamIds.has(field)),
    }))
    .filter((step) => step.fields.length > 0);

  const coveredByStep = new Set(filteredSteps.flatMap((step) => step.fields));
  const uncoveredFields = commonIds.filter((field) => !coveredByStep.has(field));
  const steps: RunActionStepDefinition[] = [
    ...filteredSteps,
    ...(uncoveredFields.length ? [{ id: 'main', fields: uncoveredFields }] : []),
  ];

  if (!steps.length && mergedParameters.length) {
    steps.push({ id: 'main', fields: mergedParameters.map((param) => param.id) });
  }

  return {
    parameters: mergedParameters,
    steps,
  };
}

export function normalizeRunActionParams(
  params: Record<string, unknown> | undefined,
  metadata: RepoRunActionMetadata,
): {
  normalized: Record<string, RunActionParamValue>;
  sensitiveValues: string[];
} {
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
    throw new Error('RUN params must be an object.');
  }

  const paramValues = params ?? {};
  const definitionsById = new Map(
    metadata.parameters.map((definition) => [definition.id, definition]),
  );
  const unknownKeys = Object.keys(paramValues).filter((key) => !definitionsById.has(key));
  if (unknownKeys.length) {
    throw new Error(`RUN params contain unknown keys: ${unknownKeys.join(', ')}.`);
  }

  const normalized: Record<string, RunActionParamValue> = {};
  const sensitiveValues: string[] = [];
  const errors: string[] = [];

  for (const definition of metadata.parameters) {
    const raw = Object.prototype.hasOwnProperty.call(paramValues, definition.id)
      ? paramValues[definition.id]
      : undefined;
    let value = normalizeParamValueByDefinition(raw, definition);
    if (raw !== undefined && value === undefined) {
      errors.push(`Invalid value for run param "${definition.id}".`);
      continue;
    }

    if (value === undefined) {
      const defaultValue = normalizeDefaultForType(definition.default, definition.type);
      value = defaultValue;
    }

    if (value === undefined) {
      if (definition.required) {
        errors.push(`Missing required run param "${definition.id}".`);
      }
      continue;
    }

    if (definition.options?.length) {
      const optionSet = new Set(definition.options.map(normalizeOptionValue));
      const values = Array.isArray(value) ? value : [value];
      if (
        values.some(
          (entry) => typeof entry !== 'string' || !optionSet.has(normalizeOptionValue(entry)),
        )
      ) {
        errors.push(`Run param "${definition.id}" is outside allowed options.`);
        continue;
      }
    }

    if (typeof value === 'number') {
      if (definition.min !== undefined && value < definition.min) {
        errors.push(`Run param "${definition.id}" must be >= ${definition.min}.`);
        continue;
      }
      if (definition.max !== undefined && value > definition.max) {
        errors.push(`Run param "${definition.id}" must be <= ${definition.max}.`);
        continue;
      }
    }

    normalized[definition.id] = value;
    if (definition.sensitive) {
      if (Array.isArray(value)) {
        sensitiveValues.push(...value);
      } else {
        sensitiveValues.push(String(value));
      }
    }
  }

  if (errors.length) {
    throw new Error(errors.join(' '));
  }

  return {
    normalized,
    sensitiveValues,
  };
}

export function intersectRunActionIds(
  repoActionSets: string[][],
  availableActionIds: string[],
): string[] {
  if (!repoActionSets.length) return [];

  const safeNormalizeActionIds = (actionIds: string[]): string[] => {
    const unique = new Set<string>();
    for (const actionId of actionIds) {
      const normalized = tryNormalizeRunActionId(actionId);
      if (normalized) {
        unique.add(normalized);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  };

  const availableSet = new Set(safeNormalizeActionIds(availableActionIds));
  let intersection = new Set<string>(safeNormalizeActionIds(repoActionSets[0] ?? []));

  for (const repoActionIds of repoActionSets.slice(1)) {
    const normalized = new Set(safeNormalizeActionIds(repoActionIds));
    intersection = new Set(Array.from(intersection).filter((value) => normalized.has(value)));
  }

  return Array.from(intersection)
    .filter((value) => availableSet.has(value))
    .sort((a, b) => a.localeCompare(b));
}
