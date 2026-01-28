import { buildCompletionBlocks } from '@sniptail/core/slack/blocks.js';
import type { SlackIds } from '@sniptail/core/slack/ids.js';

export function buildSlackCompletionPayload(
  text: string,
  jobId: string,
  slackIds: SlackIds,
): { text: string; blocks: unknown[] } {
  return {
    text,
    blocks: buildCompletionBlocks(text, jobId, slackIds.actions),
  };
}
