import { getAgentSessionStore } from './store.js';
import type { AgentSessionRecord, AgentSessionStatus, CreateAgentSessionInput } from './types.js';

export type { AgentSessionRecord, AgentSessionStatus, CreateAgentSessionInput };

export async function createAgentSession(
  input: CreateAgentSessionInput,
): Promise<AgentSessionRecord> {
  const store = await getAgentSessionStore();
  return store.createSession(input);
}

export async function loadAgentSession(sessionId: string): Promise<AgentSessionRecord | undefined> {
  const store = await getAgentSessionStore();
  return store.loadSession(sessionId);
}

export async function findDiscordAgentSessionByThread(
  threadId: string,
): Promise<AgentSessionRecord | undefined> {
  const store = await getAgentSessionStore();
  return store.findSessionByThread({ provider: 'discord', threadId });
}

export async function updateAgentSessionStatus(
  sessionId: string,
  status: AgentSessionStatus,
): Promise<AgentSessionRecord | undefined> {
  const store = await getAgentSessionStore();
  return store.updateSessionStatus(sessionId, status);
}

export async function updateAgentSessionCodingAgentSessionId(
  sessionId: string,
  codingAgentSessionId: string,
): Promise<AgentSessionRecord | undefined> {
  const store = await getAgentSessionStore();
  return store.updateCodingAgentSessionId(sessionId, codingAgentSessionId);
}
