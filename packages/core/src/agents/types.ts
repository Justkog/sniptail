import type { JobSpec, AgentId } from '../types/job.js';

export type AgentRunResult = {
  finalResponse: string;
  threadId?: string;
};

export type AgentRunOptions = {
  onEvent?: (event: unknown) => void | Promise<void>;
  sandboxMode?: 'read-only' | 'workspace-write';
  approvalPolicy?: 'never' | 'on-request';
  skipGitRepoCheck?: boolean;
  additionalDirectories?: string[];
  networkAccessEnabled?: boolean;
  webSearchEnabled?: boolean;
  botName?: string;
  resumeThreadId?: string;
  docker?: {
    enabled?: boolean;
    dockerfilePath?: string;
    image?: string;
    buildContext?: string;
  };
};

export type AgentAdapter = {
  run: (
    job: JobSpec,
    workDir: string,
    env: NodeJS.ProcessEnv,
    options?: AgentRunOptions,
  ) => Promise<AgentRunResult>;
  formatEvent?: (event: unknown) => string;
  summarizeEvent?: (event: unknown) => { text: string; isError: boolean } | null;
};

export type AgentRegistry = Record<AgentId, AgentAdapter>;
