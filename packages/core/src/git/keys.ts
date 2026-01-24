const repoKeySanitizePattern = /[^A-Za-z0-9._-]+/g;

export function sanitizeRepoKey(value: string): string {
  return value.trim().replace(repoKeySanitizePattern, '-').replace(/^-+/, '').replace(/-+$/, '');
}
