import { z } from 'zod';

/** One release in the changelog bundled with the app (docs/PRD.md UI-10), newest first. */
export const changelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  items: z.array(z.string()),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;
