import { LRUCache } from 'lru-cache';

const dedupeWindowMs = 2 * 60 * 1000;
const recentRequests = new LRUCache<string, number>({
  max: 5_000,
  ttl: dedupeWindowMs,
  ttlAutopurge: true,
  perf: { now: () => Date.now() },
});

export function dedupe(key: string): boolean {
  const now = Date.now();
  const existing = recentRequests.get(key);
  if (existing !== undefined && now - existing <= dedupeWindowMs) {
    return true;
  }
  recentRequests.set(key, now);
  return false;
}
