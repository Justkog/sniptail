import 'dotenv/config';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadBotPermissionsConfig } from '@sniptail/core/config/config.js';
import {
  isPermissionAction,
  PERMISSION_ACTIONS,
  type PermissionAction,
} from '@sniptail/core/permissions/permissionsActionCatalog.js';
import {
  explainPermissionDecision,
  type PermissionRuleTraceEntry,
} from '@sniptail/core/permissions/permissionsPolicyEngine.js';
import type {
  PermissionActor,
  PermissionContext,
  PermissionDecision,
  PermissionSubject,
} from '@sniptail/core/permissions/permissionsPolicyTypes.js';
import { isKnownChannelProvider, type KnownChannelProvider } from '@sniptail/core/types/channel.js';

type PermissionsExplainInput = {
  action: PermissionAction;
  actor: PermissionActor;
  context: PermissionContext;
};

export type PermissionsExplainPayload = {
  command: 'permissions.explain';
  input: PermissionsExplainInput;
  decision: PermissionDecision;
  matchedRule: string;
  trace: PermissionRuleTraceEntry[];
};

function printUsage(): void {
  process.stderr.write(
    [
      'Usage: permissions <command> [options]',
      '',
      'Commands:',
      '  explain  Explain one permission decision',
      '',
      'Examples:',
      '  permissions explain --action jobs.implement --provider discord --channel-id 123 --user-id 456',
      '  permissions explain --action jobs.run --provider slack --channel-id C123 --user-id U123 --group-id S_APPROVERS --repo my-api --json',
      '',
    ].join('\n'),
  );
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function asStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

function parseRequiredString(value: unknown, optionName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${optionName} is required.`);
  }
  return value.trim();
}

function parseAction(value: unknown): PermissionAction {
  const action = parseRequiredString(value, '--action');
  if (!isPermissionAction(action)) {
    throw new Error(
      `Invalid --action value: ${action}. Expected one of: ${PERMISSION_ACTIONS.join(', ')}.`,
    );
  }
  return action;
}

function parseProvider(value: unknown): KnownChannelProvider {
  const provider = parseRequiredString(value, '--provider').toLowerCase();
  if (!isKnownChannelProvider(provider)) {
    throw new Error('Invalid --provider value. Expected one of: slack, discord, telegram.');
  }
  return provider;
}

function formatSubject(subject: PermissionSubject): string {
  if (subject.kind === 'user') {
    return `user:${subject.userId}`;
  }
  return `${subject.provider}:${subject.groupId}`;
}

function formatTraceEntry(entry: PermissionRuleTraceEntry): string {
  if (entry.kind === 'default') {
    return `matched default: ${entry.effect}`;
  }
  if (entry.status === 'matched') {
    return `matched ${entry.ruleId}: ${entry.effect}`;
  }
  return `skipped ${entry.ruleId}: ${entry.reasons.join(', ')}`;
}

export function buildPermissionsExplainPayload(
  input: PermissionsExplainInput,
): PermissionsExplainPayload {
  const config = loadBotPermissionsConfig();
  const explanation = explainPermissionDecision({
    config,
    actor: input.actor,
    context: input.context,
    action: input.action,
  });
  return {
    command: 'permissions.explain',
    input,
    decision: explanation.decision,
    matchedRule: explanation.matchedRule,
    trace: explanation.trace,
  };
}

export function formatPermissionsExplainPayload(payload: PermissionsExplainPayload): string {
  const lines = [
    `decision: ${payload.decision.effect}`,
    `action: ${payload.input.action}`,
    `provider: ${payload.input.context.provider}`,
    `channelId: ${payload.input.context.channelId}`,
    `userId: ${payload.input.actor.userId}`,
  ];
  if (payload.input.context.repoKeys?.length) {
    lines.push(`repoKeys: ${payload.input.context.repoKeys.join(', ')}`);
  }
  if (payload.input.actor.groupIds.length) {
    lines.push(`groupIds: ${payload.input.actor.groupIds.join(', ')}`);
  }
  if (payload.input.context.threadId) {
    lines.push(`threadId: ${payload.input.context.threadId}`);
  }
  if (payload.input.context.workspaceId) {
    lines.push(`workspaceId: ${payload.input.context.workspaceId}`);
  }
  if (payload.input.context.guildId) {
    lines.push(`guildId: ${payload.input.context.guildId}`);
  }
  lines.push(`matchedRule: ${payload.matchedRule}`);
  if (payload.decision.approverSubjects.length) {
    lines.push(
      `approverSubjects: ${payload.decision.approverSubjects.map(formatSubject).join(', ')}`,
    );
  }
  if (payload.decision.notifySubjects.length) {
    lines.push(`notifySubjects: ${payload.decision.notifySubjects.map(formatSubject).join(', ')}`);
  }
  lines.push('trace:');
  for (const entry of payload.trace) {
    lines.push(`- ${formatTraceEntry(entry)}`);
  }
  return lines.join('\n');
}

export function handlePermissionsExplain(args: string[]): {
  payload: PermissionsExplainPayload;
  asJson: boolean;
} {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      action: { type: 'string' },
      provider: { type: 'string' },
      'channel-id': { type: 'string' },
      'user-id': { type: 'string' },
      'group-id': { type: 'string', multiple: true },
      repo: { type: 'string', multiple: true },
      'thread-id': { type: 'string' },
      'workspace-id': { type: 'string' },
      'guild-id': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  if (parsed.positionals.length > 0) {
    throw new Error('Usage: permissions explain [options]');
  }

  const action = parseAction(parsed.values.action);
  const provider = parseProvider(parsed.values.provider);
  const channelId = parseRequiredString(parsed.values['channel-id'], '--channel-id');
  const userId = parseRequiredString(parsed.values['user-id'], '--user-id');
  const groupIds = asStringArray(parsed.values['group-id'])
    .map((value) => value.trim())
    .filter(Boolean);
  const repoKeys = asStringArray(parsed.values.repo)
    .map((value) => value.trim())
    .filter(Boolean);
  const threadId =
    typeof parsed.values['thread-id'] === 'string' ? parsed.values['thread-id'].trim() : '';
  const workspaceId =
    typeof parsed.values['workspace-id'] === 'string' ? parsed.values['workspace-id'].trim() : '';
  const guildId =
    typeof parsed.values['guild-id'] === 'string' ? parsed.values['guild-id'].trim() : '';

  const payload = buildPermissionsExplainPayload({
    action,
    actor: {
      provider,
      userId,
      groupIds,
    },
    context: {
      provider,
      channelId,
      ...(repoKeys.length ? { repoKeys } : {}),
      ...(threadId ? { threadId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(guildId ? { guildId } : {}),
    },
  });

  return {
    payload,
    asJson: Boolean(parsed.values.json),
  };
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exitCode = command ? 0 : 1;
    return;
  }
  if (command !== 'explain') {
    throw new Error(`Unknown permissions command: ${command}`);
  }

  const result = handlePermissionsExplain(args);
  if (result.asJson) {
    writeJson(result.payload);
    return;
  }
  process.stdout.write(`${formatPermissionsExplainPayload(result.payload)}\n`);
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.stderr.write('Run this command with `--help` for usage.\n');
    process.exitCode = 1;
  }
}
