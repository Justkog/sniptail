import { describe, expect, it } from 'vitest';
import {
  buildAnswerQuestionsModal,
  buildAskModal,
  buildExploreModal,
  buildImplementModal,
  buildPlanModal,
} from './modals.js';
import {
  SLACK_CONTEXT_FILE_INPUT_ACTION_ID,
  SLACK_CONTEXT_FILE_INPUT_BLOCK_ID,
} from './helpers.js';

const repoAllowlist = {
  repoA: { sshUrl: 'git@example.com:org/repo-a.git', projectId: 1 },
};

function findContextFilesBlock(
  blocks: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return blocks.find((block) => block.block_id === SLACK_CONTEXT_FILE_INPUT_BLOCK_ID);
}

describe('Slack modal file inputs', () => {
  it('adds a file input block to ask, explore, plan, implement, and answer questions modals', () => {
    const views = [
      buildAskModal(repoAllowlist, 'Sniptail', 'ask-submit', '{}'),
      buildExploreModal(repoAllowlist, 'Sniptail', 'explore-submit', '{}'),
      buildPlanModal(repoAllowlist, 'Sniptail', 'plan-submit', '{}'),
      buildImplementModal(repoAllowlist, 'Sniptail', 'implement-submit', '{}'),
      buildAnswerQuestionsModal('Sniptail', 'answer-submit', '{}', ['Question 1']),
    ];

    for (const view of views) {
      const block = findContextFilesBlock(view.blocks as Array<Record<string, unknown>>);
      expect(block).toBeDefined();
      expect(block?.optional).toBe(true);
      expect(block?.element).toMatchObject({
        type: 'file_input',
        action_id: SLACK_CONTEXT_FILE_INPUT_ACTION_ID,
        max_files: 3,
      });
    }
  });
});
