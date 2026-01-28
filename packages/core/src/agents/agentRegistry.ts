import type { AgentRegistry } from './types.js';
import { runCodex } from '../codex/codex.js';
import { formatCodexEvent, summarizeCodexEvent } from '../codex/logging.js';
import { runCopilot } from '../copilot/copilot.js';
import { formatCopilotEvent, summarizeCopilotEvent } from '../copilot/logging.js';

export const AGENT_REGISTRY: AgentRegistry = {
  codex: {
    run: runCodex,
    formatEvent: formatCodexEvent as (event: unknown) => string,
    summarizeEvent: summarizeCodexEvent as (
      event: unknown,
    ) => { text: string; isError: boolean } | null,
  },
  copilot: {
    run: runCopilot,
    formatEvent: formatCopilotEvent as (event: unknown) => string,
    summarizeEvent: summarizeCopilotEvent as (
      event: unknown,
    ) => { text: string; isError: boolean } | null,
  },
};
