import type { SlackHandlerContext } from '../context.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';

function parseSelectedRepoKeys(payload: unknown): string[] {
  const values = (
    payload as { view?: { state?: { values?: Record<string, Record<string, unknown>> } } }
  ).view?.state?.values;
  const reposValue = values?.repos?.repo_keys as
    | {
        selected_options?: Array<{ value?: string }>;
      }
    | undefined;
  return reposValue?.selected_options?.map((option) => option.value).filter(Boolean) as string[];
}

export function registerRunActionSelectOptions({ app, slackIds, config }: SlackHandlerContext) {
  app.options(slackIds.actions.runActionSelect, async ({ ack, body }) => {
    const query = ((body as { value?: string }).value ?? '').trim().toLowerCase();
    const repoKeys = parseSelectedRepoKeys(body);
    const options = computeAvailableRunActions(config, repoKeys)
      .filter((action) => {
        if (!query) return true;
        return (
          action.id.toLowerCase().includes(query) ||
          action.label.toLowerCase().includes(query) ||
          action.description?.toLowerCase().includes(query)
        );
      })
      .slice(0, 100)
      .map((action) => ({
        text: {
          type: 'plain_text' as const,
          text: action.label,
        },
        value: action.id,
        ...(action.description
          ? {
              description: {
                type: 'plain_text' as const,
                text: action.description.slice(0, 75),
              },
            }
          : {}),
      }));

    await ack({ options });
  });
}
