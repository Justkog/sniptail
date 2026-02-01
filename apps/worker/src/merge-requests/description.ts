function buildCodeFence(content: string): { open: string; close: string } {
  const matches = content.match(/`+/g);
  const maxBackticks = matches ? Math.max(...matches.map((match) => match.length)) : 0;
  const fence = '`'.repeat(Math.max(3, maxBackticks + 1));
  return { open: `${fence}text`, close: fence };
}

export function buildMergeRequestDescription(
  summary: string,
  requestText: string,
  botName: string,
  jobId: string,
): string {
  const trimmedRequest = requestText.trim();
  const trimmedSummary = summary.trim();
  const baseSummary = trimmedSummary || `${botName} job ${jobId}`;
  if (!trimmedRequest) {
    return baseSummary;
  }
  const fence = buildCodeFence(trimmedRequest);
  return ['User request (raw):', fence.open, trimmedRequest, fence.close, '', baseSummary].join(
    '\n',
  );
}
