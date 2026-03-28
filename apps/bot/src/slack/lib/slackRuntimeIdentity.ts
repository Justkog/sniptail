import type { App } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';

export type SlackRuntimeIdentity = {
  botUserId?: string;
  botId?: string;
  teamId?: string;
};

const runtimeIdentityCache = new WeakMap<App, Promise<SlackRuntimeIdentity>>();

export async function resolveSlackRuntimeIdentity(app: App): Promise<SlackRuntimeIdentity> {
  const cached = runtimeIdentityCache.get(app);
  if (cached) {
    return cached;
  }

  const promise = app.client.auth
    .test()
    .then((auth) => ({
      ...(auth.user_id ? { botUserId: auth.user_id } : {}),
      ...(auth.bot_id ? { botId: auth.bot_id } : {}),
      ...(auth.team_id ? { teamId: auth.team_id } : {}),
    }))
    .catch((err) => {
      runtimeIdentityCache.delete(app);
      logger.warn({ err }, 'Failed to resolve Slack runtime identity');
      throw err;
    });

  runtimeIdentityCache.set(app, promise);
  return promise;
}
