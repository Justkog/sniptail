import type { ChannelProvider } from '../types/channel.js';
import type { ChannelAdapterBase } from './adapter.js';

export class ChannelRegistry<TAdapter extends ChannelAdapterBase> {
  private readonly adapters = new Map<ChannelProvider, TAdapter>();

  constructor(adapters: Iterable<TAdapter> = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: TAdapter): this {
    if (this.adapters.has(adapter.providerId)) {
      throw new Error(`Channel adapter already registered for provider "${adapter.providerId}".`);
    }
    this.adapters.set(adapter.providerId, adapter);
    return this;
  }

  resolve(providerId: ChannelProvider): TAdapter | undefined {
    return this.adapters.get(providerId);
  }

  require(providerId: ChannelProvider): TAdapter {
    const adapter = this.resolve(providerId);
    if (!adapter) {
      throw new Error(`No channel adapter registered for provider "${providerId}".`);
    }
    return adapter;
  }

  list(): TAdapter[] {
    return [...this.adapters.values()];
  }
}
