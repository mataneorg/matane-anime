import { z } from 'zod';
import { settingsPatchSchema } from './settings';

/**
 * "Test connection" (docs/PRD.md NET-8). The form's values that are not saved yet travel with the call, so the
 * test says what the settings on screen would do; whatever is left out is read from the saved settings.
 */
export const networkTestInputSchema = z.object({
  settings: settingsPatchSchema.optional(),
  /** Unsaved password; undefined uses the stored one, null means none. */
  proxyPassword: z.string().nullable().optional(),
});
export type NetworkTestInput = z.infer<typeof networkTestInputSchema>;

export const networkTestResultSchema = z.object({
  ok: z.boolean(),
  /** Round trip in milliseconds; null when the request failed. */
  ms: z.number().nullable(),
  /** Why it failed, in words for the user; null when it worked. */
  error: z.string().nullable(),
});
export type NetworkTestResult = z.infer<typeof networkTestResultSchema>;

/** What the renderer may know about the proxy password: never the value. */
export const proxyPasswordInfoSchema = z.object({
  stored: z.boolean(),
  /** False when the system keyring is missing and the password sits in the database as plain text. */
  encrypted: z.boolean(),
});
export type ProxyPasswordInfo = z.infer<typeof proxyPasswordInfoSchema>;
