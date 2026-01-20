export function toSlackCommandPrefix(botName: string, fallback = 'sniptail'): string {
  const normalized = botName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}
