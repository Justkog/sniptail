import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '@sniptail/core/config/config.js';

const infoMock = vi.hoisted(() => vi.fn());
const createFileTransportLoggerMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/logger.js', () => ({
  createFileTransportLogger: createFileTransportLoggerMock,
  logger: {
    warn: vi.fn(),
  },
}));

function makeConfig(): BotConfig {
  return {
    auditLogPath: '/tmp/request-audit.jsonl',
  } as BotConfig;
}

describe('auditAgentSessionStart', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createFileTransportLoggerMock.mockReturnValue({
      info: infoMock,
    });
  });

  it('writes agent session start records to the configured audit logger', async () => {
    const { auditAgentSessionStart } = await import('./requestAudit.js');

    auditAgentSessionStart(
      makeConfig(),
      {
        sessionId: 'session-1',
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
        workspaceId: 'W1',
        requestText: 'inspect the failing tests',
        contextFileCount: 2,
        workspaceKey: 'snatch',
        agentProfileKey: 'build',
        cwd: 'apps/bot',
      },
      'accepted',
    );

    expect(createFileTransportLoggerMock).toHaveBeenCalledWith('/tmp/request-audit.jsonl');
    expect(infoMock).toHaveBeenCalledWith({
      event: 'agent.session.start',
      outcome: 'accepted',
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U1',
      workspaceId: 'W1',
      requestText: 'inspect the failing tests',
      contextFileCount: 2,
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/bot',
    });
  });
});
