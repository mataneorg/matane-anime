import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/**
 * Starts the built app (`out/`, so run `pnpm e2e`, which builds first) with a throwaway profile.
 * Pass `onboarding: true` to see the first-run flow instead of skipping it.
 * `--no-sandbox` is for CI runners that forbid user namespaces; local runs do not need it.
 */
export async function launchApp(
  env: Record<string, string> = {},
  options: { userData?: string; onboarding?: boolean } = {},
): Promise<LaunchedApp> {
  // Pass the `userData` of an earlier launch to start the app again on the same profile (restart tests).
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'matane-anime-e2e-'));
  // The package folder, not out/main/index.js: `app.getAppPath()` must be apps/desktop, as in `pnpm dev`
  // (it is where drizzle/ and e2e/fixtures/ are found).
  const args = [resolve(__dirname, '../..'), `--user-data-dir=${userData}`];
  if (process.env['MATANE_E2E_NO_SANDBOX'] === '1') args.push('--no-sandbox');
  const app = await electron.launch({
    args,
    env: { ...process.env, ...env, ELECTRON_RENDERER_URL: '' } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // A fresh profile starts with the first-run flow (phase 5); the specs that are not about it mark it done.
  if (!options.onboarding) {
    await page.evaluate(() =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke('settings.set', {
        onboardingDone: true,
      }),
    );
  }
  return { app, page, userData };
}
