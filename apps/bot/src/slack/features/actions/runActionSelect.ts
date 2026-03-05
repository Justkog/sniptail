import type { SlackHandlerContext } from '../context.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';

type RunActionSelectMetadata = {
  repoKeys?: string[];
};

function parseRunActionSelectMetadata(payload: unknown): RunActionSelectMetadata | undefined {
  const privateMetadata = (payload as { view?: { private_metadata?: string } }).view
    ?.private_metadata;
  if (!privateMetadata?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(privateMetadata) as RunActionSelectMetadata;
  } catch {
    return undefined;
  }
}

function parseSelectedRepoKeysFromState(payload: unknown): string[] {
  const values = (
    payload as { view?: { state?: { values?: Record<string, Record<string, unknown>> } } }
  ).view?.state?.values;
  const reposValue = values?.repos?.repo_keys as
    | {
        selected_options?: Array<{ value?: string }>;
      }
    | undefined;
  return (
    reposValue?.selected_options
      ?.map((option) => option.value)
      .filter((value): value is string => Boolean(value)) ?? []
  );
}

export function registerRunActionSelectOptions({ app, slackIds, config }: SlackHandlerContext) {
  app.options(slackIds.actions.runActionSelect, async ({ ack, body }) => {
    const query = ((body as { value?: string }).value ?? '').trim().toLowerCase();
    const metadata = parseRunActionSelectMetadata(body);
    const repoKeys = metadata?.repoKeys ?? parseSelectedRepoKeysFromState(body);
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
