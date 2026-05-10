import { randomUUID } from 'node:crypto';
import type {
  AcpCreateElicitationRequest,
  AcpCreateElicitationResponse,
} from '@sniptail/core/acp/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { BotAgentQuestion } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import {
  buildQuestionRequestEvent,
  publishQuestionUpdated,
} from '../agent-command/interactiveAgentEvents.js';

type AgentResponse = CoreWorkerEvent<'agent.session.start'>['payload']['response'];

type PendingAcpQuestion = {
  sessionId: string;
  interactionId: string;
  response: AgentResponse;
  schema: QuestionSchema;
  timeout: NodeJS.Timeout;
  resolveResult: (result: AcpCreateElicitationResponse) => void;
};

type RequestAcpQuestionInput = {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
  request: AcpCreateElicitationRequest;
  flushOutput?: () => Promise<void>;
};

type ResolveInput = {
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  notifier: Notifier;
  botEvents: BotEventSink;
};

type ClearInput = {
  sessionId: string;
  botEvents?: BotEventSink;
  message?: string;
};

type QuestionFieldSchema =
  | {
      key: string;
      label: string;
      question: BotAgentQuestion;
      required: boolean;
      kind: 'string';
    }
  | {
      key: string;
      label: string;
      question: BotAgentQuestion;
      required: boolean;
      kind: 'string_enum';
      options: Array<{ label: string; value: string }>;
    }
  | {
      key: string;
      label: string;
      question: BotAgentQuestion;
      required: boolean;
      kind: 'boolean';
      options: Array<{ label: string; value: boolean }>;
    }
  | {
      key: string;
      label: string;
      question: BotAgentQuestion;
      required: boolean;
      kind: 'number' | 'integer';
    }
  | {
      key: string;
      label: string;
      question: BotAgentQuestion;
      required: boolean;
      kind: 'array';
      options: Array<{ label: string; value: string }>;
      minItems?: number;
      maxItems?: number;
    };

type QuestionSchema = {
  fields: QuestionFieldSchema[];
};

const pendingQuestions = new Map<string, PendingAcpQuestion>();

function pendingInteractionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

function cancelQuestionResponse(): AcpCreateElicitationResponse {
  return { action: 'cancel' };
}

function buildRef(response: AgentResponse) {
  return {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
}

function getPendingQuestion(
  sessionId: string,
  interactionId: string,
): PendingAcpQuestion | undefined {
  return pendingQuestions.get(pendingInteractionKey(sessionId, interactionId));
}

function deletePendingQuestion(question: PendingAcpQuestion): void {
  pendingQuestions.delete(pendingInteractionKey(question.sessionId, question.interactionId));
  clearTimeout(question.timeout);
}

function normalizeTextAnswers(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function firstAnswer(values: string[] | undefined): string | undefined {
  return normalizeTextAnswers(values)[0];
}

function buildFieldPrompt(
  requestMessage: string,
  label: string,
  description?: string | null,
): string {
  const parts = [requestMessage.trim()];
  if (description?.trim()) {
    parts.push(description.trim());
  } else {
    parts.push(`Provide ${label}.`);
  }
  return parts.join('\n\n');
}

function buildStringOptions(
  schema:
    | {
        enum?: string[] | null;
        oneOf?: Array<{ const: string; title: string }> | null;
      }
    | undefined,
): Array<{ label: string; value: string }> | undefined {
  if (!schema) return undefined;
  if (schema.oneOf?.length) {
    return schema.oneOf.map((option) => ({
      label: option.title,
      value: option.const,
    }));
  }
  if (schema.enum?.length) {
    return schema.enum.map((value) => ({
      label: value,
      value,
    }));
  }
  return undefined;
}

function buildArrayOptions(
  items:
    | { enum: string[]; type: 'string' }
    | { anyOf: Array<{ const: string; title: string }> }
    | undefined,
): Array<{ label: string; value: string }> | undefined {
  if (!items) return undefined;
  if ('anyOf' in items) {
    return items.anyOf.map((option) => ({
      label: option.title,
      value: option.const,
    }));
  }
  if ('enum' in items) {
    return items.enum.map((value) => ({
      label: value,
      value,
    }));
  }
  return undefined;
}

function renderLimitIssue(
  provider: AgentResponse['provider'],
  questions: BotAgentQuestion[],
): string | undefined {
  if (provider !== 'discord') {
    return undefined;
  }
  if (questions.length === 0) {
    return 'ACP elicitation did not include any fields.';
  }
  if (questions.length > 5) {
    return 'ACP elicitation has more questions than Discord modals can support.';
  }
  if (questions.slice(4).some((entry) => entry.options.length > 0 && entry.custom === false)) {
    return 'ACP elicitation has too many choice questions for Discord controls.';
  }
  return undefined;
}

function buildQuestionSchema(request: AcpCreateElicitationRequest): QuestionSchema | string {
  if (request.mode !== 'form') {
    return 'ACP URL elicitation is not supported by the current Sniptail question UI.';
  }

  const properties = request.requestedSchema.properties;
  if (!properties || Object.keys(properties).length === 0) {
    return 'ACP elicitation form did not include any fields.';
  }

  const required = new Set(request.requestedSchema.required ?? []);
  const fields: QuestionFieldSchema[] = [];

  for (const [key, property] of Object.entries(properties)) {
    const label = property.title?.trim() || key;
    const questionText = buildFieldPrompt(request.message, label, property.description);
    const base = {
      key,
      label,
      question: {
        header: label,
        question: questionText,
        options: [],
        multiple: false,
        custom: true,
      } satisfies BotAgentQuestion,
      required: required.has(key),
    };

    if (property.type === 'string') {
      const options = buildStringOptions(property);
      if (options) {
        fields.push({
          ...base,
          kind: 'string_enum',
          options,
          question: {
            ...base.question,
            options: options.map((option) => ({ label: option.label })),
            custom: false,
          },
        });
        continue;
      }
      fields.push({ ...base, kind: 'string' });
      continue;
    }

    if (property.type === 'boolean') {
      const options = [
        { label: 'True', value: true },
        { label: 'False', value: false },
      ];
      fields.push({
        ...base,
        kind: 'boolean',
        options,
        question: {
          ...base.question,
          options: options.map((option) => ({ label: option.label })),
          custom: false,
        },
      });
      continue;
    }

    if (property.type === 'number' || property.type === 'integer') {
      fields.push({ ...base, kind: property.type });
      continue;
    }

    if (property.type === 'array') {
      const options = buildArrayOptions(property.items);
      if (!options) {
        return `ACP elicitation field "${key}" uses an unsupported array schema.`;
      }
      fields.push({
        ...base,
        kind: 'array',
        options,
        ...(typeof property.minItems === 'number' ? { minItems: property.minItems } : {}),
        ...(typeof property.maxItems === 'number' ? { maxItems: property.maxItems } : {}),
        question: {
          ...base.question,
          options: options.map((option) => ({ label: option.label })),
          multiple: true,
          custom: false,
        },
      });
      continue;
    }

    return `ACP elicitation field "${key}" uses an unsupported property type.`;
  }

  return { fields };
}

function buildAnswerContent(
  schema: QuestionSchema,
  answers: string[][] | undefined,
): { content?: Record<string, string | number | boolean | string[]>; error?: string } {
  const content: Record<string, string | number | boolean | string[]> = {};

  for (const [index, field] of schema.fields.entries()) {
    const group = normalizeTextAnswers(answers?.[index]);

    if (field.kind === 'array') {
      if (group.length === 0) {
        if (field.required) {
          return { error: `${field.label} requires at least one answer.` };
        }
        continue;
      }
      const values = group.map((answer) => {
        const option = field.options.find((candidate) => candidate.label === answer);
        return option?.value;
      });
      if (values.some((value) => !value)) {
        return { error: `${field.label} contains an unsupported selection.` };
      }
      if (typeof field.minItems === 'number' && values.length < field.minItems) {
        return { error: `${field.label} requires at least ${field.minItems} selection(s).` };
      }
      if (typeof field.maxItems === 'number' && values.length > field.maxItems) {
        return { error: `${field.label} allows at most ${field.maxItems} selection(s).` };
      }
      content[field.key] = values as string[];
      continue;
    }

    const answer = firstAnswer(group);
    if (!answer) {
      if (field.required) {
        return { error: `${field.label} requires an answer.` };
      }
      continue;
    }

    if (field.kind === 'string') {
      content[field.key] = answer;
      continue;
    }

    if (field.kind === 'string_enum') {
      const option = field.options.find((candidate) => candidate.label === answer);
      if (!option) {
        return { error: `${field.label} contains an unsupported selection.` };
      }
      content[field.key] = option.value;
      continue;
    }

    if (field.kind === 'boolean') {
      const option = field.options.find((candidate) => candidate.label === answer);
      if (!option) {
        return { error: `${field.label} must be True or False.` };
      }
      content[field.key] = option.value;
      continue;
    }

    if (field.kind === 'number' || field.kind === 'integer') {
      const parsed = Number(answer);
      if (!Number.isFinite(parsed)) {
        return { error: `${field.label} must be a valid number.` };
      }
      if (field.kind === 'integer' && !Number.isInteger(parsed)) {
        return { error: `${field.label} must be a valid integer.` };
      }
      content[field.key] = parsed;
      continue;
    }
  }

  return Object.keys(content).length > 0 ? { content } : {};
}

async function timeoutQuestion(input: {
  sessionId: string;
  interactionId: string;
  botEvents: BotEventSink;
}) {
  const pending = getPendingQuestion(input.sessionId, input.interactionId);
  if (!pending) {
    return;
  }

  deletePendingQuestion(pending);
  pending.resolveResult(cancelQuestionResponse());
  await publishQuestionUpdated({
    botEvents: input.botEvents,
    response: pending.response,
    sessionId: pending.sessionId,
    interactionId: pending.interactionId,
    status: 'expired',
    message: 'Question request expired.',
  });
}

export async function requestAcpQuestion(
  input: RequestAcpQuestionInput,
): Promise<AcpCreateElicitationResponse> {
  const schema = buildQuestionSchema(input.request);
  if (typeof schema === 'string') {
    logger.warn(
      { sessionId: input.sessionId, workspaceKey: input.workspaceKey, reason: schema },
      'ACP elicitation request is not compatible with the current Sniptail question UI',
    );
    return cancelQuestionResponse();
  }

  const questions = schema.fields.map((field) => field.question);
  const limitIssue = renderLimitIssue(input.response.provider, questions);
  if (limitIssue) {
    logger.warn(
      { sessionId: input.sessionId, workspaceKey: input.workspaceKey, reason: limitIssue },
      'ACP elicitation request exceeds current channel render limits',
    );
    return cancelQuestionResponse();
  }

  return await new Promise<AcpCreateElicitationResponse>((resolveResult) => {
    const interactionId = randomUUID();
    const expiresAt = new Date(Date.now() + input.timeoutMs).toISOString();
    const pending: PendingAcpQuestion = {
      sessionId: input.sessionId,
      interactionId,
      response: input.response,
      schema,
      timeout: setTimeout(() => {
        void timeoutQuestion({
          sessionId: input.sessionId,
          interactionId,
          botEvents: input.botEvents,
        });
      }, input.timeoutMs),
      resolveResult,
    };

    pendingQuestions.set(pendingInteractionKey(input.sessionId, interactionId), pending);

    void (async () => {
      await input.flushOutput?.();
      await input.botEvents.publish(
        buildQuestionRequestEvent({
          response: input.response,
          sessionId: input.sessionId,
          interactionId,
          workspaceKey: input.workspaceKey,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          questions,
          expiresAt,
        }),
      );
    })().catch((err) => {
      logger.error(
        { err, sessionId: input.sessionId, interactionId },
        'Failed to publish ACP question request',
      );
      const current = getPendingQuestion(input.sessionId, interactionId);
      if (!current) {
        return;
      }
      deletePendingQuestion(current);
      current.resolveResult(cancelQuestionResponse());
    });
  });
}

export async function resolveAcpQuestionInteraction({
  event,
  notifier,
  botEvents,
}: ResolveInput): Promise<void> {
  const { sessionId, interactionId, resolution, response } = event.payload;
  const ref = buildRef(response);
  const pending = getPendingQuestion(sessionId, interactionId);

  if (!pending) {
    await notifier.postMessage(ref, 'This agent interaction is no longer pending.');
    return;
  }

  if (resolution.kind !== 'question') {
    await notifier.postMessage(
      ref,
      'This agent interaction no longer matches the selected control.',
    );
    return;
  }

  if (resolution.reject) {
    deletePendingQuestion(pending);
    pending.resolveResult({ action: 'decline' });
    await publishQuestionUpdated({
      botEvents,
      response: pending.response,
      sessionId,
      interactionId,
      status: 'rejected',
      ...(response.userId ? { actorUserId: response.userId } : {}),
      ...(resolution.message ? { message: resolution.message } : {}),
    });
    return;
  }

  const result = buildAnswerContent(pending.schema, resolution.answers);
  if (result.error) {
    await notifier.postMessage(ref, result.error);
    return;
  }

  deletePendingQuestion(pending);
  pending.resolveResult(
    result.content ? { action: 'accept', content: result.content } : { action: 'accept' },
  );
  await publishQuestionUpdated({
    botEvents,
    response: pending.response,
    sessionId,
    interactionId,
    status: 'answered',
    ...(response.userId ? { actorUserId: response.userId } : {}),
    ...(resolution.message ? { message: resolution.message } : {}),
  });
}

export async function clearAcpQuestionInteractions({
  sessionId,
  botEvents,
  message = 'Agent session ended before this interaction was resolved.',
}: ClearInput): Promise<void> {
  const stale: PendingAcpQuestion[] = [];

  for (const pending of pendingQuestions.values()) {
    if (pending.sessionId === sessionId) {
      stale.push(pending);
    }
  }

  for (const pending of stale) {
    deletePendingQuestion(pending);
    pending.resolveResult(cancelQuestionResponse());
    if (botEvents) {
      await publishQuestionUpdated({
        botEvents,
        response: pending.response,
        sessionId: pending.sessionId,
        interactionId: pending.interactionId,
        status: 'failed',
        message,
      });
    }
  }
}

export function buildAcpQuestionHandler(input: {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
  flushOutput?: () => Promise<void>;
}): (request: AcpCreateElicitationRequest) => Promise<AcpCreateElicitationResponse> {
  return async (request: AcpCreateElicitationRequest) =>
    await requestAcpQuestion({
      ...input,
      request,
    });
}
