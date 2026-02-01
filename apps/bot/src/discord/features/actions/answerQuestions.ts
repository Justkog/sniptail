import type { ButtonInteraction } from 'discord.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { buildAnswerQuestionsModal } from '../../modals.js';
import { answerQuestionsByUser } from '../../state.js';

export async function handleAnswerQuestionsButton(interaction: ButtonInteraction, jobId: string) {
  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for answer questions');
    return undefined;
  });

  const openQuestions = record?.openQuestions ?? [];
  if (!openQuestions.length) {
    await interaction.reply({
      content: `No open questions were recorded for job ${jobId}.`,
      ephemeral: true,
    });
    return;
  }

  answerQuestionsByUser.set(interaction.user.id, {
    jobId,
    openQuestions,
    requestedAt: Date.now(),
  });

  const config = loadBotConfig();
  const modal = buildAnswerQuestionsModal(config.botName, openQuestions);
  await interaction.showModal(modal);
}
