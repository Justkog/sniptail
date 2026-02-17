export type RepoProvider = string;

export type RepoRow = {
  repoKey: string;
  provider: RepoProvider;
  sshUrl?: string;
  localPath?: string;
  projectId?: number;
  providerData?: Record<string, unknown>;
  baseBranch: string;
  isActive: boolean;
};

export interface RepoCatalogStore {
  kind: 'pg' | 'sqlite' | 'redis';
  listActiveRows(): Promise<RepoRow[]>;
  upsertRow(row: RepoRow): Promise<void>;
  close?(): Promise<void>;
}
