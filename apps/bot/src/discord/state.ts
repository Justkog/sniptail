export const askSelectionByUser = new Map<string, { repoKeys: string[]; requestedAt: number }>();
export const exploreSelectionByUser = new Map<
  string,
  { repoKeys: string[]; requestedAt: number }
>();
export const planSelectionByUser = new Map<string, { repoKeys: string[]; requestedAt: number }>();
export const answerQuestionsByUser = new Map<
  string,
  { jobId: string; openQuestions: string[]; requestedAt: number }
>();
export const implementSelectionByUser = new Map<
  string,
  { repoKeys: string[]; requestedAt: number }
>();
export const runSelectionByUser = new Map<
  string,
  { repoKeys: string[]; actionId?: string; requestedAt: number }
>();
export const bootstrapExtrasByUser = new Map<
  string,
  {
    service: string;
    visibility: 'private' | 'public';
    quickstart: boolean;
    requestedAt: number;
  }
>();
