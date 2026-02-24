import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { AgentId } from '@sniptail/core/types/job.js';
import { assertLocalCopilotPreflight } from '../copilot/copilotPreflight.js';
import { assertLocalCodexPreflight } from '../codex/codexPreflight.js';

export async function assertLocalAgentPreflight(
  config: WorkerConfig,
  agentId: AgentId,
): Promise<void> {
  switch (agentId) {
    case 'codex':
      await assertLocalCodexPreflight(config);
      return;
    case 'copilot':
      await assertLocalCopilotPreflight(config);
      return;
  }
}
