import { runCommand } from '../runner/commandRunner.js';

type UsageKind = 'daily' | 'weekly';

type UsageEntry = {
  kind: UsageKind;
  percent: number;
  reset: string;
};

type UsageSummary = {
  daily?: UsageEntry;
  weekly?: UsageEntry;
  raw: string;
};

type QuotaWindow = {
  used_percent?: number;
  reset_after_seconds?: number;
  reset_at?: number;
};

type QuotaRateLimit = {
  primary_window?: QuotaWindow;
  secondary_window?: QuotaWindow;
};

type QuotaUsage = {
  rate_limit?: QuotaRateLimit;
};

type QuotaEntry = {
  label?: string;
  usage?: QuotaUsage;
};

function formatTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function resolveResetAtMs(window: QuotaWindow): number | undefined {
  if (typeof window.reset_at === 'number' && Number.isFinite(window.reset_at) && window.reset_at > 0) {
    return window.reset_at * 1000;
  }
  if (
    typeof window.reset_after_seconds === 'number' &&
    Number.isFinite(window.reset_after_seconds) &&
    window.reset_after_seconds >= 0
  ) {
    return Date.now() + window.reset_after_seconds * 1000;
  }
  return undefined;
}

function formatDailyReset(window: QuotaWindow): string | undefined {
  if (
    typeof window.reset_after_seconds === 'number' &&
    Number.isFinite(window.reset_after_seconds) &&
    window.reset_after_seconds <= 0
  ) {
    return 'now';
  }
  const resetAtMs = resolveResetAtMs(window);
  if (!resetAtMs) return undefined;
  const resetDate = new Date(resetAtMs);
  if (Number.isNaN(resetDate.getTime())) return undefined;
  return `${formatTwoDigits(resetDate.getHours())}:${formatTwoDigits(resetDate.getMinutes())}`;
}

function formatWeeklyReset(window: QuotaWindow): string | undefined {
  const resetAtMs = resolveResetAtMs(window);
  if (!resetAtMs) return undefined;
  const resetDate = new Date(resetAtMs);
  if (Number.isNaN(resetDate.getTime())) return undefined;
  return `${formatTwoDigits(resetDate.getMonth() + 1)}/${formatTwoDigits(resetDate.getDate())}`;
}

function buildUsageEntry(
  kind: UsageKind,
  window: QuotaWindow | undefined,
  formatResetValue: (window: QuotaWindow) => string | undefined,
): UsageEntry | undefined {
  if (!window || typeof window.used_percent !== 'number' || Number.isNaN(window.used_percent)) {
    return undefined;
  }
  const reset = formatResetValue(window) ?? 'unknown';
  return {
    kind,
    percent: window.used_percent,
    reset,
  };
}

function parseQuotaEntries(raw: string): QuotaEntry[] | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const parseCandidate = (candidate: string): QuotaEntry[] | undefined => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as QuotaEntry[];
      }
      if (parsed && typeof parsed === 'object') {
        return [parsed as QuotaEntry];
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  const direct = parseCandidate(text);
  if (direct) return direct;

  const firstArrayStart = text.indexOf('[');
  const lastArrayEnd = text.lastIndexOf(']');
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    return parseCandidate(text.slice(firstArrayStart, lastArrayEnd + 1));
  }

  return undefined;
}

function parseUsageOutput(raw: string): UsageSummary {
  const summary: UsageSummary = { raw };
  const entries = parseQuotaEntries(raw);
  if (!entries?.length) {
    return summary;
  }

  const codexCliEntry =
    entries.find((entry) => entry.label === 'codex-cli' && entry.usage?.rate_limit) ??
    entries.find((entry) => entry.usage?.rate_limit);
  const rateLimit = codexCliEntry?.usage?.rate_limit;
  if (!rateLimit) {
    return summary;
  }

  const daily = buildUsageEntry('daily', rateLimit.primary_window, formatDailyReset);
  const weekly = buildUsageEntry('weekly', rateLimit.secondary_window, formatWeeklyReset);
  if (daily) summary.daily = daily;
  if (weekly) summary.weekly = weekly;
  return summary;
}

function formatReset(entry: UsageEntry): string {
  if (entry.reset === 'now') return 'resets now';
  if (/^\d+h$/.test(entry.reset)) return `resets in ${entry.reset}`;
  return `resets on ${entry.reset}`;
}

function buildUsageMessage(summary: UsageSummary): string | null {
  const segments: string[] = [];
  if (summary.daily) {
    segments.push(`Daily ${summary.daily.percent}% (${formatReset(summary.daily)})`);
  }
  if (summary.weekly) {
    segments.push(`Weekly ${summary.weekly.percent}% (${formatReset(summary.weekly)})`);
  }
  if (!segments.length) return null;
  return `Codex usage: ${segments.join('. ')}.`;
}

export async function fetchCodexUsageMessage(): Promise<{ message: string; raw: string }> {
  const result = await runCommand(
    'npx',
    ['codex-quota', 'codex', 'quota', '--json'],
    { timeoutMs: 10_000, allowFailure: true },
  );
  const raw = `${result.stdout}${result.stderr}`.trim();
  const summary = parseUsageOutput(raw);
  const message = buildUsageMessage(summary);
  if (message) {
    return { message, raw };
  }
  return {
    message:
      'Sorry, I could not read the Codex usage output. Try again or run `npx codex-quota codex quota --json`.',
    raw,
  };
}
