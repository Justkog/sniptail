export function parseBootstrapExtras(value: string) {
  const extras: {
    gitlabNamespaceId?: number;
    localPath?: string;
  } = {};
  if (!value.trim()) return extras;

  const pairs = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split('=');
    const key = rawKey?.trim().toLowerCase();
    const rawValue = rest.join('=')?.trim();
    if (!key || !rawValue) continue;

    if (key === 'gitlab_namespace_id') {
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isNaN(parsed)) {
        extras.gitlabNamespaceId = parsed;
      }
    } else if (key === 'local_path') {
      extras.localPath = rawValue;
    }
  }

  return extras;
}
