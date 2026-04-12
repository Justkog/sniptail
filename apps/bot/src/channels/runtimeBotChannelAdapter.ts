import type { App } from '@slack/bolt';
import type { Client } from 'discord.js';
import type { Bot } from 'grammy';
import type { BotChannelAdapter, ChannelAdapterBase } from '@sniptail/core/channels/adapter.js';
import type { CoreBotEvent, CoreBotEventType } from '@sniptail/core/types/bot-event.js';

export type BotEventRuntime = {
  slackApp?: App;
  discordClient?: Client;
  telegramBot?: Bot;
};

export interface RuntimeBotChannelAdapter
  extends ChannelAdapterBase, BotChannelAdapter<CoreBotEvent, BotEventRuntime> {
  supportedEventTypes: readonly CoreBotEventType[];
}
