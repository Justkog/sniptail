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

function classifyUsage(reset: string, summary: UsageSummary): UsageKind {
  if (reset === 'now' || /^\d+h$/.test(reset)) {
    return 'daily';
  }
  if (/^\d{2}\/\d{2}$/.test(reset)) {
    return 'weekly';
  }
  return summary.daily ? 'weekly' : 'daily';
}

function parseUsageOutput(raw: string): UsageSummary {
  const summary: UsageSummary = { raw };
  const matches = raw.matchAll(/(\d+)%\/([^\s]+)/g);
  for (const match of matches) {
    const percent = Number(match[1]);
    const reset = match[2];
    if (Number.isNaN(percent)) continue;
    const kind = classifyUsage(reset!, summary);
    summary[kind] = { kind, percent, reset: reset! };
  }
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
    ['codex-status', '--minimal', '--format', 'daily,weekly'],
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
      'Sorry, I could not read the Codex usage output. Try again or run `npx codex-status --minimal --format "daily,weekly"`.',
    raw,
  };
}
