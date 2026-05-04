import type { AgentSessionRecord } from '@sniptail/core/agent-sessions/types.js';
import type { WorkerAgentCommandProfileConfig, WorkerConfig } from '@sniptail/core/config/types.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';

export type InteractiveAgentProvider = WorkerAgentCommandProfileConfig['provider'];

export type InteractiveAgentProfile = WorkerAgentCommandProfileConfig & {
  key: string;
};

export type AgentSessionTurn = {
  sessionId: string;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  prompt: string;
  workspaceKey: string;
  profile: InteractiveAgentProfile;
  cwd?: string;
  codingAgentSessionId?: string;
};

export type RunInteractiveAgentTurnInput = {
  turn: AgentSessionTurn;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
};

export type SteerInteractiveAgentTurnInput = {
  sessionId: string;
  response: CoreWorkerEvent<'agent.session.message'>['payload']['response'];
  profile: InteractiveAgentProfile;
  config: WorkerConfig;
  notifier: Notifier;
  env: NodeJS.ProcessEnv;
};

export type StopInteractiveAgentPromptInput = {
  event: CoreWorkerEvent<'agent.prompt.stop'>;
  session: AgentSessionRecord;
  profile: InteractiveAgentProfile;
  config: WorkerConfig;
  notifier: Notifier;
  env: NodeJS.ProcessEnv;
};

export type ResolveInteractiveAgentInteractionInput = {
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  session: AgentSessionRecord;
  profile: InteractiveAgentProfile;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
};

export type InteractiveAgentAdapter = {
  provider: InteractiveAgentProvider;
  displayName: string;
  runTurn: (input: RunInteractiveAgentTurnInput) => Promise<void>;
  steerActiveTurn: (input: SteerInteractiveAgentTurnInput) => Promise<void>;
  stopPrompt: (input: StopInteractiveAgentPromptInput) => Promise<void>;
  resolveInteraction: (input: ResolveInteractiveAgentInteractionInput) => Promise<void>;
};
