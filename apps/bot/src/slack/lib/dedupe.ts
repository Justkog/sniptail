const recentRequests = new Map<string, number>();
const dedupeWindowMs = 2 * 60 * 1000;

export function dedupe(key: string): boolean {
  const now = Date.now();
  for (const [storedKey, ts] of recentRequests.entries()) {
    if (now - ts > dedupeWindowMs) {
      recentRequests.delete(storedKey);
    }
  }
  if (recentRequests.has(key)) {
    return true;
  }
  recentRequests.set(key, now);
  return false;
}
