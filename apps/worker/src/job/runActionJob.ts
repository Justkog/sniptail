import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { WorkerConfig } from '@sniptail/core/config/config.js';
import { runNamedRunContractDetailed } from '@sniptail/core/git/jobOps.js';
import { logger } from '@sniptail/core/logger.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import { CommandError, runCommand, type RunResult } from '@sniptail/core/runner/commandRunner.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { JobResult, MergeRequestResult, JobSpec } from '@sniptail/core/types/job.js';
import type { Notifier } from '../channels/notifier.js';
import type { WorkerChannelAdapter } from '../channels/runtimeWorkerChannelAdapter.js';
import type { prepareRepoWorktrees } from '../repos/worktrees.js';
import type { JobRegistry } from './jobRegistry.js';

const RUN_CHANNEL_SUMMARY_MAX_CHARS = 1200;
const RUN_CHANNEL_PREVIEW_MAX_CHARS = 180;
const RUN_REPORT_STREAM_MAX_LINES = 40;
const RUN_REPORT_STREAM_MAX_CHARS = 6000;
const RUN_FAILURE_STREAM_MAX_LINES = 12;
const RUN_FAILURE_STREAM_MAX_CHARS = 600;

type RunExecutionStatus = 'ok' | 'nonzero-allowed';
type RunExecutionSource = 'contract' | 'fallback';
type RepoWorktrees = Awaited<ReturnType<typeof prepareRepoWorktrees>>['repoWorktrees'];
type RunJobPaths = {
  artifactsRoot: string;
  logFile: string;
};

type RunExecutionRecord = {
  repoKey: string;
  source: RunExecutionSource;
  commandDisplay: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  status: RunExecutionStatus;
};

type RunPublishRepoChanges = (
  actionId: string,
  checks?: string[],
) => Promise<{
  mergeRequests: MergeRequestResult[];
  localBranchMessages: string[];
}>;

type RunJobInput = {
  registry: JobRegistry;
  job: JobSpec;
  config: WorkerConfig;
  paths: RunJobPaths;
  env: NodeJS.ProcessEnv;
  redactionPatterns: Array<string | RegExp>;
  repoWorktrees: RepoWorktrees;
  branchByRepo: Record<string, string>;
  notifier: Notifier;
  channelAdapter: WorkerChannelAdapter;
  channelRef: ChannelRef;
  publishRepoChanges: RunPublishRepoChanges;
};

function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? 'null' : String(exitCode);
}

function truncateWithEllipsis(input: string, maxChars: number): string {
  if (maxChars <= 0 || input.length <= maxChars) {
    return input;
  }
  if (maxChars <= 3) {
    return '.'.repeat(maxChars);
  }
  return `${input.slice(0, maxChars - 3)}...`;
}

function tailOutput(
  input: string,
  maxLines: number,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (!input) {
    return { text: '', truncated: false };
  }

  const normalized = input.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const lineSlice =
    maxLines > 0 && lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  let text = lineSlice.join('\n');
  let truncated = lineSlice.length !== lines.length;

  if (maxChars > 0 && text.length > maxChars) {
    text = text.slice(text.length - maxChars);
    truncated = true;
  }

  return { text, truncated };
}

function buildRunPreview(record: RunExecutionRecord): string {
  const preferred = record.stderr.trim() ? record.stderr : record.stdout;
  if (!preferred.trim()) {
    return 'no output';
  }
  const stream = record.stderr.trim() ? 'stderr' : 'stdout';
  const collapsed = preferred.replace(/\s+/g, ' ').trim();
  return `${stream}: ${truncateWithEllipsis(collapsed, RUN_CHANNEL_PREVIEW_MAX_CHARS)}`;
}

function buildRunChannelSummary(records: RunExecutionRecord[]): string {
  if (!records.length) {
    return 'No run command output captured.';
  }
  const lines = records.map((record) => {
    const statusSuffix = record.status === 'nonzero-allowed' ? ' [allow_failure]' : '';
    return `- ${record.repoKey}: ${record.source} exit=${formatExitCode(record.exitCode)} (${record.durationMs}ms)${statusSuffix} | ${buildRunPreview(record)}`;
  });
  return truncateWithEllipsis(lines.join('\n'), RUN_CHANNEL_SUMMARY_MAX_CHARS);
}

function buildRunReportOutputSection(records: RunExecutionRecord[]): string {
  if (!records.length) {
    return '_No run command output captured._';
  }

  const sections: string[] = [];
  for (const record of records) {
    const stdoutTail = tailOutput(
      record.stdout,
      RUN_REPORT_STREAM_MAX_LINES,
      RUN_REPORT_STREAM_MAX_CHARS,
    );
    const stderrTail = tailOutput(
      record.stderr,
      RUN_REPORT_STREAM_MAX_LINES,
      RUN_REPORT_STREAM_MAX_CHARS,
    );
    const statusSuffix = record.status === 'nonzero-allowed' ? ' (allow_failure)' : '';
    sections.push(`### ${record.repoKey}`);
    sections.push(`- Source: \`${record.source}\``);
    sections.push(`- Command: \`${record.commandDisplay}\``);
    sections.push(`- Exit code: \`${formatExitCode(record.exitCode)}\`${statusSuffix}`);
    sections.push(`- Duration: \`${record.durationMs}ms\``);
    sections.push('');
    sections.push(`#### stderr tail${stderrTail.truncated ? ' (truncated)' : ''}`);
    if (stderrTail.text.trim()) {
      sections.push('```text');
      sections.push(stderrTail.text);
      sections.push('```');
    } else {
      sections.push('_No stderr output._');
    }
    sections.push('');
    sections.push(`#### stdout tail${stdoutTail.truncated ? ' (truncated)' : ''}`);
    if (stdoutTail.text.trim()) {
      sections.push('```text');
      sections.push(stdoutTail.text);
      sections.push('```');
    } else {
      sections.push('_No stdout output._');
    }
    sections.push('');
  }
  sections.push('_See logs/runner.log for full command streams._');
  return sections.join('\n');
}

function buildRunExecutionRows(records: RunExecutionRecord[]): string[] {
  return records.map((record) => {
    const statusSuffix = record.status === 'nonzero-allowed' ? ' [allow_failure]' : '';
    return `- ${record.repoKey}: ${record.source} (\`${record.commandDisplay}\`) exit=${formatExitCode(record.exitCode)} duration=${record.durationMs}ms${statusSuffix}`;
  });
}

function buildRunExecutionRecord(options: {
  repoKey: string;
  source: RunExecutionSource;
  commandDisplay: string;
  result: RunResult;
}): RunExecutionRecord {
  const { repoKey, source, commandDisplay, result } = options;
  const status: RunExecutionStatus = result.exitCode === 0 ? 'ok' : 'nonzero-allowed';
  return {
    repoKey,
    source,
    commandDisplay,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    status,
  };
}

export function buildRunJobFailureSnippet(err: unknown): string | undefined {
  if (!(err instanceof CommandError)) {
    return undefined;
  }
  const preferred = err.result.stderr.trim() ? err.result.stderr : err.result.stdout;
  if (!preferred.trim()) {
    return undefined;
  }
  const stream = err.result.stderr.trim() ? 'stderr' : 'stdout';
  const tail = tailOutput(preferred, RUN_FAILURE_STREAM_MAX_LINES, RUN_FAILURE_STREAM_MAX_CHARS);
  const lines = [
    `Recent command ${stream} output${tail.truncated ? ' (truncated)' : ''}:`,
    '```text',
    tail.text,
    '```',
  ];
  return lines.join('\n');
}

export async function runRunJob(options: RunJobInput): Promise<JobResult> {
  const {
    registry,
    job,
    config,
    paths,
    env,
    redactionPatterns,
    repoWorktrees,
    branchByRepo,
    notifier,
    channelAdapter,
    channelRef,
    publishRepoChanges,
  } = options;

  const actionId = normalizeRunActionId(job.run?.actionId ?? '');
  const actionConfig = config.run?.actions[actionId];
  if (!actionConfig) {
    throw new Error(`Run action "${actionId}" is not configured in worker config.`);
  }

  const executionRecords: RunExecutionRecord[] = [];
  for (const [repoKey, repo] of repoWorktrees.entries()) {
    const contractExecution = await runNamedRunContractDetailed(
      repo.worktreePath,
      actionId,
      env,
      paths.logFile,
      redactionPatterns,
      {
        timeoutMs: actionConfig.timeoutMs,
        allowFailure: actionConfig.allowFailure,
      },
    );
    if (contractExecution.executed) {
      executionRecords.push(
        buildRunExecutionRecord({
          repoKey,
          source: 'contract',
          commandDisplay: `.sniptail/run/${actionId}`,
          result: contractExecution.result,
        }),
      );
      continue;
    }

    const fallbackCommand = actionConfig.fallbackCommand;
    const command = fallbackCommand?.[0];
    const args = fallbackCommand?.slice(1) ?? [];
    if (!command) {
      throw new Error(
        `No run contract found for action "${actionId}" in repo "${repoKey}" and no fallback_command configured.`,
      );
    }
    const result = await runCommand(command, args, {
      cwd: repo.worktreePath,
      env,
      logFilePath: paths.logFile,
      timeoutMs: actionConfig.timeoutMs,
      redact: redactionPatterns,
      allowFailure: actionConfig.allowFailure,
    });
    executionRecords.push(
      buildRunExecutionRecord({
        repoKey,
        source: 'fallback',
        commandDisplay: [command, ...args].join(' '),
        result,
      }),
    );
  }

  let mergeRequests: MergeRequestResult[] = [];
  let localBranchMessages: string[] = [];
  if (actionConfig.gitMode === 'implement') {
    const published = await publishRepoChanges(actionId, actionConfig.checks);
    mergeRequests = published.mergeRequests;
    localBranchMessages = published.localBranchMessages;
  }

  const mrTextParts: string[] = [];
  if (mergeRequests.length) {
    mrTextParts.push(mergeRequests.map((mr) => `${mr.repoKey}: ${mr.url}`).join('\n'));
  }
  if (localBranchMessages.length) {
    mrTextParts.push(localBranchMessages.join('\n'));
  }
  const mrText = mrTextParts.length ? mrTextParts.join('\n') : 'No merge requests created.';

  const executionRows = buildRunExecutionRows(executionRecords);
  const reportSections = [
    `# Run Job ${job.jobId}`,
    '',
    `- Action ID: \`${actionId}\``,
    `- Git mode: \`${actionConfig.gitMode}\``,
    '',
    '## Execution',
    ...executionRows,
    '',
    '## Output Snippets',
    buildRunReportOutputSection(executionRecords),
  ];
  if (actionConfig.gitMode === 'implement') {
    reportSections.push('', '## Git Output', mrText);
  }
  const report = reportSections.join('\n');
  const reportPath = join(paths.artifactsRoot, 'report.md');
  await writeFile(reportPath, `${report}\n`, 'utf8');

  await notifier.uploadFile(channelRef, {
    fileContent: report,
    title: `sniptail-${job.jobId}-report.md`,
  });

  const outputSummary = buildRunChannelSummary(executionRecords);
  const completionLines = [
    `All set! I finished run job ${job.jobId} (action: ${actionId}).`,
    '',
    'Run output preview:',
    outputSummary,
  ];
  if (actionConfig.gitMode === 'implement') {
    completionLines.push('', 'Git output:', mrText);
  }
  const completionText = completionLines.join('\n');
  const includeReviewFromJob =
    actionConfig.gitMode === 'implement' && Object.keys(branchByRepo).length > 0;
  const rendered = channelAdapter.renderCompletionMessage({
    botName: config.botName,
    text: completionText,
    jobId: job.jobId,
    includeReviewFromJob,
  });
  await notifier.postMessage(channelRef, rendered.text, rendered.options);
  await registry
    .updateJobRecord(job.jobId, {
      status: 'ok',
      summary: report.slice(0, 500),
      ...(mergeRequests.length ? { mergeRequests } : {}),
    })
    .catch((err) => {
      logger.warn({ err, jobId: job.jobId }, 'Failed to mark RUN job as ok');
    });
  return {
    jobId: job.jobId,
    status: 'ok',
    summary: report.slice(0, 500),
    reportPath,
    ...(mergeRequests.length ? { mergeRequests } : {}),
  };
}
