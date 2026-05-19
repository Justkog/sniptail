import { describe, expect, it } from 'vitest';
import {
  agentSessionIndexKey,
  agentSessionKey,
  DEFAULT_WORKER_HEARTBEAT_TTL_MS,
  REGISTRY_KEY_VERSION,
  workerCapabilityIndexKey,
  workerCapabilityKey,
  workerHeartbeatKey,
} from './redisRegistryKeys.js';

describe('redis registry keys', () => {
  it('generates namespaced versioned keys', () => {
    expect(REGISTRY_KEY_VERSION).toBe('v1');
    expect(DEFAULT_WORKER_HEARTBEAT_TTL_MS).toBe(90_000);
    expect(workerCapabilityKey('prod', 'worker-a')).toBe(
      'sniptail:registry:prod:v1:worker-capability:worker-a',
    );
    expect(workerHeartbeatKey('prod', 'worker-a')).toBe(
      'sniptail:registry:prod:v1:worker-heartbeat:worker-a',
    );
    expect(workerCapabilityIndexKey('prod')).toBe(
      'sniptail:registry:prod:v1:worker-capability-index',
    );
    expect(agentSessionKey('prod', 'session-1')).toBe(
      'sniptail:registry:prod:v1:agent-session:session-1',
    );
    expect(agentSessionIndexKey('prod')).toBe('sniptail:registry:prod:v1:agent-session-index');
  });
});
