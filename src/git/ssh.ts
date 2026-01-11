type ParsedSshUrl = {
  host: string;
  path: string;
};

export function parseSshUrl(sshUrl: string): ParsedSshUrl | null {
  const trimmed = sshUrl.trim();
  const sshMatch = trimmed.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { host: sshMatch[1], path: sshMatch[2] };
  }
  const scpMatch = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scpMatch) {
    return { host: scpMatch[1], path: scpMatch[2] };
  }
  return null;
}

export function isGitHubSshUrl(sshUrl: string): boolean {
  const parsed = parseSshUrl(sshUrl);
  if (!parsed) return false;
  return parsed.host.toLowerCase().includes('github');
}

export function parseGitHubRepo(sshUrl: string): { owner: string; repo: string } | null {
  const parsed = parseSshUrl(sshUrl);
  if (!parsed) return null;
  const cleaned = parsed.path.replace(/\.git$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}
