import { describe, expect, it } from 'vitest';
import { getAgentSessionPreviewAdapter } from './agentSessionPreviewAdapters.js';

describe('agentSessionPreviewAdapters', () => {
  it('registers ACP session preview support', () => {
    expect(getAgentSessionPreviewAdapter('acp')?.provider).toBe('acp');
  });

  it('keeps OpenCode session preview support registered', () => {
    expect(getAgentSessionPreviewAdapter('opencode')?.provider).toBe('opencode');
  });
});
