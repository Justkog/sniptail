import { describe, expect, it } from 'vitest';
import { ChannelRegistry } from './registry.js';
import type { ChannelAdapterBase } from './adapter.js';

type TestAdapter = ChannelAdapterBase & { name: string };

describe('ChannelRegistry', () => {
  it('registers and resolves adapters by provider id', () => {
    const slackAdapter: TestAdapter = {
      providerId: 'slack',
      capabilities: {},
      name: 'slack-adapter',
    };
    const registry = new ChannelRegistry<TestAdapter>([slackAdapter]);

    expect(registry.resolve('slack')).toEqual(slackAdapter);
    expect(registry.resolve('discord')).toBeUndefined();
    expect(registry.list()).toEqual([slackAdapter]);
  });

  it('throws when registering duplicate providers', () => {
    const registry = new ChannelRegistry<TestAdapter>();
    registry.register({
      providerId: 'slack',
      capabilities: {},
      name: 'adapter-a',
    });

    expect(() =>
      registry.register({
        providerId: 'slack',
        capabilities: {},
        name: 'adapter-b',
      }),
    ).toThrow('Channel adapter already registered for provider "slack".');
  });
});
