import type { InteractiveAgentAdapter, InteractiveAgentProvider } from './interactiveAgentTypes.js';
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
    opencode: openCodeInteractiveAgent,
    copilot: copilotInteractiveAgent,
  };

export function getInteractiveAgentAdapter(provider: InteractiveAgentProvider) {
  return INTERACTIVE_AGENT_REGISTRY[provider];
}
