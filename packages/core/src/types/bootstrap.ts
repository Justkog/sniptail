import type { ChannelContext } from './channel.js';

export type RepoBootstrapService = string;

export type BootstrapRequest = {
  requestId: string;
  repoName: string;
  repoKey: string;
  service: RepoBootstrapService;
  providerData?: Record<string, unknown>;
  owner?: string;
  description?: string;
  visibility?: 'private' | 'public';
  quickstart?: boolean;
  gitlabNamespaceId?: number;
  localPath?: string;
  channel: ChannelContext;
};
