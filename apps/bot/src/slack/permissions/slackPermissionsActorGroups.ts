import type { App } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';

export type GroupMembershipCacheEntry = {
  expiresAt: number;
  userIds: Set<string>;
};

export async function resolveSlackActorGroups(input: {
  client: App['client'];
  userId: string;
  candidateGroupIds: string[];
  cache: Map<string, GroupMembershipCacheEntry>;
  cacheTtlMs: number;
}): Promise<string[]> {
  const now = Date.now();
  const matches: string[] = [];

  for (const groupId of input.candidateGroupIds) {
    const cacheKey = `slack:${groupId}`;
    const cached = input.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      if (cached.userIds.has(input.userId)) {
        matches.push(groupId);
      }
      continue;
    }

    try {
      const response = await input.client.usergroups.users.list({
        usergroup: groupId,
      });
      const users =
        (
          response as {
            users?: string[];
          }
        ).users ?? [];
      const userIds = new Set(users);
      input.cache.set(cacheKey, {
        expiresAt: now + input.cacheTtlMs,
        userIds,
      });
      if (userIds.has(input.userId)) {
        matches.push(groupId);
      }
    } catch (err) {
      logger.warn({ err, groupId }, 'Failed to resolve Slack usergroup members');
    }
  }

  return matches;
}
