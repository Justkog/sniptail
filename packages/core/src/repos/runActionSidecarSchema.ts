import { z } from 'zod';
import {
  type RepoRunActionMetadata,
  type RunActionParamDefinition,
  type RunActionStepDefinition,
} from './runActions.js';

const runParamTypeSchema = z.enum(['string', 'number', 'boolean', 'string[]']);
const runParamUiModeSchema = z.enum([
  'auto',
  'text',
  'textarea',
  'select',
  'multiselect',
  'boolean',
  'number',
  'secret',
]);

const runActionParamSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: runParamTypeSchema,
    ui_mode: runParamUiModeSchema.optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    description: z.string().optional(),
    options: z.array(z.string()).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    default: z
      .union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())])
      .optional(),
  })
  .passthrough();

const runActionStepSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    fields: z.array(z.string()),
  })
  .passthrough();

const runActionSidecarSchema = z
  .object({
    schema_version: z.literal(1).optional(),
    parameters: z.array(runActionParamSchema),
    steps: z.array(runActionStepSchema).optional(),
  })
  .passthrough();

function toParamDefinition(value: z.infer<typeof runActionParamSchema>): RunActionParamDefinition {
  const options = value.options;
  const description = value.description?.trim();

  const uiMode = value.ui_mode ?? 'auto';
  const parsed: RunActionParamDefinition = {
    id: value.id,
    label: value.label,
    type: value.type,
    uiMode,
    required: value.required ?? false,
    sensitive: value.sensitive ?? uiMode === 'secret',
    ...(description ? { description } : {}),
    ...(options ? { options } : {}),
    ...(typeof value.min === 'number' ? { min: value.min } : {}),
    ...(typeof value.max === 'number' ? { max: value.max } : {}),
  };
  if (value.default !== undefined) {
    parsed.default = value.default;
  }
  return parsed;
}

function toStepDefinition(value: z.infer<typeof runActionStepSchema>): RunActionStepDefinition {
  const title = value.title?.trim();
  return {
    id: value.id,
    ...(title ? { title } : {}),
    fields: value.fields,
  };
}

export function parseRunActionSidecarTable(
  table: Record<string, unknown>,
  filePath: string,
): RepoRunActionMetadata {
  const parsed = runActionSidecarSchema.safeParse(table);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid run action sidecar ${filePath}: ${issues}`);
  }

  const parameters = parsed.data.parameters.map(toParamDefinition);
  const steps =
    parsed.data.steps !== undefined
      ? parsed.data.steps.map(toStepDefinition)
      : [{ id: 'main', fields: parameters.map((p) => p.id) }];

  return {
    parameters,
    steps,
  };
}
