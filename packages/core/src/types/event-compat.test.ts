import { describe, expect, it } from 'vitest';
import { BOT_EVENT_SCHEMA_VERSION, type BotEvent } from './bot-event.js';

describe('bot event schema', () => {
  it('accepts schema-versioned bot events', () => {
    const event: BotEvent = {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: 'discord',
      type: 'interaction.reply.edit',
      payload: {
        interactionApplicationId: 'app-1',
        interactionToken: 'token-1',
        text: 'updated',
      },
    };

    expect(event.schemaVersion).toBe(BOT_EVENT_SCHEMA_VERSION);
    expect(event.type).toBe('interaction.reply.edit');
  });
});
