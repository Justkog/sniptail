export type RepoProvider = 'github' | 'gitlab' | 'local';

export type RepoRow = {
  repoKey: string;
  provider: RepoProvider;
  sshUrl?: string;
  localPath?: string;
  projectId?: number;
  baseBranch: string;
  isActive: boolean;
};

export interface RepoCatalogStore {
  kind: 'pg' | 'sqlite' | 'redis';
  listActiveRows(): Promise<RepoRow[]>;
  upsertRow(row: RepoRow): Promise<void>;
}
