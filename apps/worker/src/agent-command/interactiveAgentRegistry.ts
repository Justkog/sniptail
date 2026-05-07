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

export const INTERACTIVE_AGENT_REGISTRY: Record<InteractiveAgentProvider, InteractiveAgentAdapter> =
  {
    codex: codexInteractiveAgent,
    opencode: openCodeInteractiveAgent,
    copilot: copilotInteractiveAgent,
  };

export function getInteractiveAgentAdapter(provider: InteractiveAgentProvider) {
  return INTERACTIVE_AGENT_REGISTRY[provider];
}
