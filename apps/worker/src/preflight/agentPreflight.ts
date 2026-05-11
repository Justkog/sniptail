import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { AgentId } from '@sniptail/core/types/job.js';
import { assertAcpPreflight } from '../acp/acpPreflight.js';
import { assertLocalCopilotPreflight } from '../copilot/copilotPreflight.js';
import { assertLocalCodexPreflight } from '../codex/codexPreflight.js';
import { assertOpenCodePreflight } from '../opencode/opencodePreflight.js';

export async function assertLocalAgentPreflight(
  config: WorkerConfig,
  agentId: AgentId,
): Promise<void> {
  switch (agentId) {
    case 'acp':
      await assertAcpPreflight(config);
      return;
    case 'codex':
      await assertLocalCodexPreflight(config);
      return;
    case 'copilot':
      await assertLocalCopilotPreflight(config);
      return;
    case 'opencode':
      await assertOpenCodePreflight(config);
      return;
    default:
      throw new Error(`Unsupported agentId '${String(agentId)}' in assertLocalAgentPreflight`);
  }
}
