import { createOpencodeClient } from '@opencode-ai/sdk/v2';

export async function assertOpenCodeServerReachable(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const client = createOpencodeClient({ baseUrl: serverUrl, headers });
  const response = await client.config.get();
  if (response.error) {
    throw new Error(JSON.stringify(response.error));
  }
}
