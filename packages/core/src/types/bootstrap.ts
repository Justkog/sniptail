import type { ChannelContext } from './channel.js';

export type RepoBootstrapService = 'github' | 'gitlab' | 'local';

export type BootstrapRequest = {
  requestId: string;
  repoName: string;
  repoKey: string;
  service: RepoBootstrapService;
  owner?: string;
  description?: string;
  visibility?: 'private' | 'public';
  quickstart?: boolean;
  gitlabNamespaceId?: number;
  localPath?: string;
  channel: ChannelContext;
};
