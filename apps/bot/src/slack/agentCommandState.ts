import type {
  BotAgentPermissionRequestPayload,
  BotAgentPermissionUpdatePayload,
  BotAgentQuestionRequestPayload,
  BotAgentQuestionUpdatePayload,
} from '@sniptail/core/types/bot-event.js';

type SlackBlock = Record<string, unknown>;

type PendingSlackAgentQuestion = BotAgentQuestionRequestPayload & {
  selections: Map<number, string[]>;
};

const pendingSlackAgentQuestions = new Map<string, PendingSlackAgentQuestion>();

function questionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

export function setPendingSlackAgentQuestion(payload: BotAgentQuestionRequestPayload): void {
  pendingSlackAgentQuestions.set(questionKey(payload.sessionId, payload.interactionId), {
    ...payload,
    selections: new Map(),
  });
}

export function getPendingSlackAgentQuestion(
  sessionId: string,
  interactionId: string,
): PendingSlackAgentQuestion | undefined {
  return pendingSlackAgentQuestions.get(questionKey(sessionId, interactionId));
}

export function clearPendingSlackAgentQuestion(sessionId: string, interactionId: string): void {
  pendingSlackAgentQuestions.delete(questionKey(sessionId, interactionId));
}

export function buildSlackAgentActionValue(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export function parseSlackAgentActionValue<T>(value: string | undefined): T | undefined {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function buildSlackAgentQuestionBlockId(
  sessionId: string,
  interactionId: string,
  questionIndex: number,
): string {
  return `agent-question:${sessionId}:${interactionId}:${questionIndex}`;
}

export function parseSlackAgentQuestionBlockId(blockId: string | undefined):
  | {
      sessionId: string;
      interactionId: string;
      questionIndex: number;
    }
  | undefined {
  if (!blockId?.startsWith('agent-question:')) return undefined;
  const parts = blockId.split(':');
  if (parts.length < 4) return undefined;
  const questionIndex = Number.parseInt(parts[parts.length - 1] ?? '', 10);
  const interactionId = parts[parts.length - 2]?.trim();
  const sessionId = parts
    .slice(1, parts.length - 2)
    .join(':')
    .trim();
  if (!sessionId || !interactionId || !Number.isInteger(questionIndex) || questionIndex < 0) {
    return undefined;
  }
  return { sessionId, interactionId, questionIndex };
}

function permissionDecisionLabel(decision: 'once' | 'always' | 'reject'): string {
  switch (decision) {
    case 'once':
      return 'Approve once';
    case 'always':
      return 'Always allow';
    case 'reject':
      return 'Reject';
  }
}

export function appendSlackAgentPermissionDecision(
  text: string,
  userId: string,
  decision: 'once' | 'always' | 'reject',
): string {
  const base = text.trim() || 'Permission requested.';
  return `${base}\n\n${permissionDecisionLabel(decision)} selected by <@${userId}>.`;
}

function questionDecisionLabel(action: 'submitted' | 'rejected' | 'selected'): string {
  if (action === 'submitted') return 'Question submitted';
  if (action === 'selected') return 'Question answer selected';
  return 'Question rejected';
}

export function appendSlackAgentQuestionDecision(
  text: string,
  userId: string,
  action: 'submitted' | 'rejected' | 'selected',
): string {
  const base = text.trim() || 'Question requested.';
  return `${base}\n\n${questionDecisionLabel(action)} by <@${userId}>.`;
}

export function appendSlackAgentStopRequested(text: string, userId: string): string {
  const base = text.trim() || 'Agent session.';
  return `${base}\n\nStop request sent by <@${userId}>.`;
}

export function appendSlackAgentFollowUpAction(
  text: string,
  userId: string,
  action: 'queue' | 'steer',
): string {
  const base = text.trim() || 'Agent session is busy.';
  const label = action === 'steer' ? 'Steer' : 'Queue';
  return `${base}\n\n${label} selected by <@${userId}>.`;
}

export function buildSlackAgentPermissionRequestText(
  payload: BotAgentPermissionRequestPayload,
): string {
  const lines = [
    '*Permission requested*',
    payload.toolName ? `Tool: \`${payload.toolName}\`` : undefined,
    payload.action ? `Action: \`${payload.action}\`` : undefined,
    `Workspace: \`${payload.workspaceKey}${payload.cwd ? ` / ${payload.cwd}` : ''}\``,
    `Expires: ${payload.expiresAt}`,
  ];
  if (payload.details?.length) {
    lines.push('Details:', ...payload.details.map((detail) => `• ${detail}`));
  }
  return lines.filter((line) => line !== undefined).join('\n');
}

export function buildSlackAgentPermissionUpdateText(
  payload: BotAgentPermissionUpdatePayload,
): string {
  const actor = payload.actorUserId ? ` by <@${payload.actorUserId}>` : '';
  if (payload.status === 'approved_once') return `Permission approved once${actor}.`;
  if (payload.status === 'approved_always') return `Permission always allowed${actor}.`;
  if (payload.status === 'rejected') return `Permission rejected${actor}.`;
  if (payload.status === 'expired') return 'Permission request expired and was rejected.';
  return 'Permission request failed.';
}

function stripTrailingSlackPermissionDecision(text: string): string {
  const markers = [
    '\n\nApprove once selected by ',
    '\n\nAlways allow selected by ',
    '\n\nReject selected by ',
  ];
  for (const marker of markers) {
    const markerIndex = text.lastIndexOf(marker);
    if (markerIndex !== -1) {
      return text.slice(0, markerIndex).trim();
    }
  }
  return text.trim();
}

export function appendSlackAgentPermissionStatus(
  text: string,
  payload: BotAgentPermissionUpdatePayload,
): string {
  const base = stripTrailingSlackPermissionDecision(text) || 'Permission requested.';
  return `${base}\n\n${buildSlackAgentPermissionUpdateText(payload)}`;
}

export function buildSlackAgentQuestionRequestText(
  payload: BotAgentQuestionRequestPayload,
): string {
  const lines = [
    '*Question requested*',
    `Workspace: \`${payload.workspaceKey}${payload.cwd ? ` / ${payload.cwd}` : ''}\``,
    `Expires: ${payload.expiresAt}`,
  ];
  const hasMultipleQuestions = payload.questions.length > 1;
  payload.questions.forEach((question, index) => {
    const header = question.header?.trim();
    const title = hasMultipleQuestions
      ? `*${header || `Question ${index + 1}`}*`
      : header
        ? `*${header}*`
        : undefined;
    lines.push('');
    if (title) {
      lines.push(title);
    }
    lines.push(question.question);
    if (question.options.length) {
      lines.push(...question.options.slice(0, 25).map((option) => `• ${option.label}`));
    }
    if (question.multiple) {
      lines.push('_Multiple choices allowed._');
    }
    if (question.custom) {
      lines.push('_Custom answer allowed._');
    }
  });
  return lines.join('\n');
}

export function buildSlackAgentQuestionUpdateText(payload: BotAgentQuestionUpdatePayload): string {
  const actor = payload.actorUserId ? ` by <@${payload.actorUserId}>` : '';
  if (payload.status === 'answered') return `Question answered${actor}.`;
  if (payload.status === 'rejected') return `Question rejected${actor}.`;
  if (payload.status === 'expired') return 'Question request expired and was rejected.';
  return 'Question request failed.';
}

function stripTrailingSlackQuestionDecision(text: string): string {
  const markers = [
    '\n\nQuestion answer selected by ',
    '\n\nQuestion rejected by ',
    '\n\nQuestion submitted by ',
  ];
  for (const marker of markers) {
    const markerIndex = text.lastIndexOf(marker);
    if (markerIndex !== -1) {
      return text.slice(0, markerIndex).trim();
    }
  }
  return text.trim();
}

export function appendSlackAgentQuestionStatus(
  text: string,
  payload: BotAgentQuestionUpdatePayload,
): string {
  const base = stripTrailingSlackQuestionDecision(text) || 'Question requested.';
  return `${base}\n\n${buildSlackAgentQuestionUpdateText(payload)}`;
}

export function buildSlackAgentStopBlocks(actionId: string, sessionId: string): SlackBlock[] {
  return [
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Stop' },
          style: 'danger',
          action_id: actionId,
          value: sessionId,
        },
      ],
    },
  ];
}

export function buildSlackAgentFollowUpBusyBlocks(
  queueActionId: string,
  steerActionId: string,
  value: string,
): SlackBlock[] {
  return [
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Queue' },
          action_id: queueActionId,
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Steer' },
          style: 'danger',
          action_id: steerActionId,
          value,
        },
      ],
    },
  ];
}

export function buildSlackAgentPermissionBlocks(
  payload: BotAgentPermissionRequestPayload,
  actionIds: {
    once: string;
    always: string;
    reject: string;
    stop: string;
  },
): SlackBlock[] {
  const decisionBase = {
    sessionId: payload.sessionId,
    interactionId: payload.interactionId,
  };
  const elements: SlackBlock[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Approve once' },
      style: 'primary',
      action_id: actionIds.once,
      value: buildSlackAgentActionValue({ ...decisionBase, decision: 'once' }),
    },
  ];
  if (payload.allowAlways) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Always allow' },
      action_id: actionIds.always,
      value: buildSlackAgentActionValue({ ...decisionBase, decision: 'always' }),
    });
  }
  elements.push(
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Reject' },
      style: 'danger',
      action_id: actionIds.reject,
      value: buildSlackAgentActionValue({ ...decisionBase, decision: 'reject' }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Stop session' },
      style: 'danger',
      action_id: actionIds.stop,
      value: payload.sessionId,
    },
  );
  return [{ type: 'actions', elements }];
}

export function buildSlackAgentQuestionBlocks(
  payload: BotAgentQuestionRequestPayload,
  actionIds: {
    select: string;
    submit: string;
    reject: string;
    custom: string;
    stop: string;
  },
): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  payload.questions.slice(0, 10).forEach((question, questionIndex) => {
    if (!question.options.length) return;
    const actionElement = question.multiple
      ? {
          type: 'multi_static_select',
          action_id: actionIds.select,
          placeholder: {
            type: 'plain_text',
            text: question.header?.trim() || `Question ${questionIndex + 1}`,
          },
          options: question.options.slice(0, 100).map((option, optionIndex) => ({
            text: { type: 'plain_text', text: option.label.slice(0, 75) },
            value: String(optionIndex),
          })),
        }
      : {
          type: 'static_select',
          action_id: actionIds.select,
          placeholder: {
            type: 'plain_text',
            text: question.header?.trim() || `Question ${questionIndex + 1}`,
          },
          options: question.options.slice(0, 100).map((option, optionIndex) => ({
            text: { type: 'plain_text', text: option.label.slice(0, 75) },
            value: String(optionIndex),
          })),
        };
    blocks.push({
      type: 'actions',
      block_id: buildSlackAgentQuestionBlockId(
        payload.sessionId,
        payload.interactionId,
        questionIndex,
      ),
      elements: [actionElement],
    });
  });

  const controls: SlackBlock[] = [];
  if (payload.questions.some((question) => question.custom)) {
    controls.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Answer with text' },
      action_id: actionIds.custom,
      value: buildSlackAgentActionValue({
        sessionId: payload.sessionId,
        interactionId: payload.interactionId,
      }),
    });
  }
  controls.push(
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Submit answers' },
      style: 'primary',
      action_id: actionIds.submit,
      value: buildSlackAgentActionValue({
        sessionId: payload.sessionId,
        interactionId: payload.interactionId,
      }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Reject' },
      style: 'danger',
      action_id: actionIds.reject,
      value: buildSlackAgentActionValue({
        sessionId: payload.sessionId,
        interactionId: payload.interactionId,
      }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Stop session' },
      style: 'danger',
      action_id: actionIds.stop,
      value: payload.sessionId,
    },
  );
  blocks.push({ type: 'actions', elements: controls });
  return blocks;
}

export function selectedLabels(
  pending: PendingSlackAgentQuestion,
  questionIndex: number,
  values: string[],
): string[] {
  const question = pending.questions[questionIndex];
  if (!question) return [];
  return values
    .map((value) => Number.parseInt(value, 10))
    .filter((optionIndex) => Number.isInteger(optionIndex) && optionIndex >= 0)
    .map((optionIndex) => question.options[optionIndex]?.label)
    .filter((label): label is string => typeof label === 'string' && label.length > 0);
}

export function buildSlackQuestionAnswers(pending: PendingSlackAgentQuestion): string[][] {
  return pending.questions.map((_, index) => pending.selections.get(index) ?? []);
}

export function missingSlackQuestionHeaders(pending: PendingSlackAgentQuestion): string[] {
  return pending.questions
    .map((question, index) => ({
      header: question.header?.trim() || question.question.trim() || `Question ${index + 1}`,
      answers: pending.selections.get(index) ?? [],
    }))
    .filter((entry) => entry.answers.length === 0)
    .map((entry) => entry.header);
}
