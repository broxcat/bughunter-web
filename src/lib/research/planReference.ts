/** Application-owned input references. They never grant network permissions. */
export type ResearchPlanReference = {
  id: string;
  contentSha256: string;
  markdownSha256: string;
  jsonPath: string;
  markdownPath: string;
};
export const isResearchPlanInput = (path: string) => /^research\/plan(?:-[a-f0-9]{64})?\.(?:json|md)$/.test(path);
