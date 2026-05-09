import type { InteractiveAgentAdapter, InteractiveAgentProvider } from './interactiveAgentTypes.js';
import {
  resolveCodexAgentInteraction,
  runCodexAgentTurn,
  steerCodexAgentTurn,
  stopCodexAgentPrompt,
} from '../codex/codexInteractiveAgent.js';
import {
  handleActiveCopilotAgentMessage,
  resolveCopilotAgentInteraction,
  runCopilotAgentTurn,
  steerCopilotAgentTurn,
  stopCopilotAgentPrompt,
} from '../copilot/copilotInteractiveAgent.js';
import {
  resolveOpenCodeAgentInteraction,
  runOpenCodeAgentTurn,
  steerOpenCodeAgentTurn,
  stopOpenCodeAgentPrompt,
} from '../opencode/openCodeInteractiveAgent.js';

function unsupportedAcpRuntime(): never {
  throw new Error('ACP interactive agent runtime is not implemented yet.');
}

const codexInteractiveAgent: InteractiveAgentAdapter = {
  provider: 'codex',
  displayName: 'Codex',
  runTurn: runCodexAgentTurn,
  steerActiveTurn: steerCodexAgentTurn,
  stopPrompt: stopCodexAgentPrompt,
  resolveInteraction: resolveCodexAgentInteraction,
};

const openCodeInteractiveAgent: InteractiveAgentAdapter = {
  provider: 'opencode',
  displayName: 'OpenCode',
  runTurn: runOpenCodeAgentTurn,
  steerActiveTurn: steerOpenCodeAgentTurn,
  stopPrompt: stopOpenCodeAgentPrompt,
  resolveInteraction: resolveOpenCodeAgentInteraction,
};

const copilotInteractiveAgent: InteractiveAgentAdapter = {
  provider: 'copilot',
  displayName: 'Copilot',
  runTurn: runCopilotAgentTurn,
  handleActiveMessage: handleActiveCopilotAgentMessage,
  steerActiveTurn: steerCopilotAgentTurn,
  stopPrompt: stopCopilotAgentPrompt,
  resolveInteraction: resolveCopilotAgentInteraction,
};

const acpInteractiveAgent: InteractiveAgentAdapter = {
  provider: 'acp',
  displayName: 'ACP',
  runTurn: () => unsupportedAcpRuntime(),
  steerActiveTurn: () => unsupportedAcpRuntime(),
  stopPrompt: () => unsupportedAcpRuntime(),
  resolveInteraction: () => unsupportedAcpRuntime(),
};

export const INTERACTIVE_AGENT_REGISTRY: Record<InteractiveAgentProvider, InteractiveAgentAdapter> =
  {
    codex: codexInteractiveAgent,
    opencode: openCodeInteractiveAgent,
    copilot: copilotInteractiveAgent,
    acp: acpInteractiveAgent,
  };

export function getInteractiveAgentAdapter(provider: InteractiveAgentProvider) {
  return INTERACTIVE_AGENT_REGISTRY[provider];
}
