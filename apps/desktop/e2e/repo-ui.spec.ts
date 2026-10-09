import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { INDEX_FILE, type RepoPackageInput, SIGNATURE_FILE, signIndex } from '@matane-anime/extension-repo';
import { TestSite, buildTestRepo, loadBuiltExtension } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 4, milestone 4e: the Extensions page, the Add repository and Install dialogs and the settings that go
// with them, as a user meets them. The repository is a fake one served by the test site; no real site is touched.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const SHOTS = resolve(__dirname, '../test-results/screens');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;

const go = (hash: string) =>
  page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
const invoke = <T = unknown>(channel: string, input?: unknown): Promise<T> =>
  page.evaluate(
    ([c, i]) =>
      (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(c as string, i),
    [channel, input] as const,
  ) as Promise<T>;
const shot = (name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
/** The screen in both flavors, once the colors have finished transitioning. */
async function shots(name: string): Promise<void> {
  await shot(`repo-ui-${name}-mocha`);
  await invoke('settings.set', { theme: 'latte' });
  await page.waitForTimeout(500);
  await shot(`repo-ui-${name}-latte`);
  await invoke('settings.set', { theme: 'mocha' });
  await page.waitForTimeout(500);
}

/** `extensions/example` and a second, never installed entry, so the lists have more than one row. */
function packages(): RepoPackageInput[] {
  const example = loadBuiltExtension(EXAMPLE);
  const mirror: RepoPackageInput = {
    ...example,
    manifest: {
      ...example.manifest,
      id: 'mirror',
      name: 'Sample Mirror',
      sources: [{ key: 'en', lang: 'en', name: 'Sample Mirror (EN)' }],
    },
  };
  return [example, mirror];
}
/**
 * The index says `future` needs an API newer than the app has (the builder refuses to pack such a manifest, so the
 * index is edited and signed again by the same key).
 */
function needNewerApi(repo: ReturnType<typeof buildTestRepo>, id: string): void {
  const bytes = repo.files.get(INDEX_FILE) as Uint8Array;
  const index = JSON.parse(Buffer.from(bytes).toString('utf8')) as { extensions: { id: string; apiVersion: number }[] };
  const entry = index.extensions.find((item) => item.id === id) as { apiVersion: number };
  entry.apiVersion = 99;
  const edited = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8');
  repo.files.set(INDEX_FILE, edited);
  repo.files.set(SIGNATURE_FILE, Buffer.from(signIndex(edited, repo.privateKeyPem), 'utf8'));
}

/** An 18+ extension in Japanese and one that needs an API newer than the app has. */
function extras(): RepoPackageInput[] {
  const example = loadBuiltExtension(EXAMPLE);
  return [
    {
      ...example,
      manifest: {
        ...example.manifest,
        id: 'adult',
        name: 'Adult Site',
        nsfw: true,
        sources: [{ key: 'ja', lang: 'ja', name: 'Adult Site (JA)' }],
      },
    },
    {
      ...example,
      manifest: {
        ...example.manifest,
        id: 'future',
        name: 'Future Site',
        sources: [{ key: 'en', lang: 'en', name: 'Future Site (EN)' }],
      },
    },
  ];
}

// Repositories are a side panel (the Matane layout): opened from the header, it holds Add repository and Check.
const panel = () => page.getByTestId('repositories-panel');
async function openRepositories(): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Repositories', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(panel()).toBeVisible();
}
async function startAdd(): Promise<void> {
  await openRepositories();
  await panel().getByRole('button', { name: 'Add repository' }).click();
}
const dialog = () => page.getByRole('dialog');
const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const row = (id: string) => page.getByTestId(`extension-${id}`);
const offer = (id: string) => page.getByTestId(`available-${id}`);

async function addRepoThroughUi(options: { trust: boolean }): Promise<void> {
  await startAdd();
  await dialog().getByLabel('Repository address').fill(site.repoUrl);
  await dialog().getByRole('button', { name: 'Check repository' }).click();
  if (options.trust)
    await dialog()
      .getByRole('checkbox', { name: /Trust this key/ })
      .check();
  await dialog().getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog()).toBeHidden();
}

async function removeEveryRepoThroughUi(): Promise<void> {
  await go('#/browse/extensions');
  await openRepositories();
  while ((await page.getByTestId(/^repo-/).count()) > 0) {
    await page
      .getByRole('button', { name: /^Remove / })
      .first()
      .click();
    await dialog().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog()).toBeHidden();
  }
}

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  first = buildTestRepo({ name: 'Example Repo', extensions: packages() });
  firstKeys = { privateKeyPem: first.privateKeyPem, publicKey: first.publicKey };
  ({ app, page } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.unmaximize();
    window?.setContentSize(1440, 900);
  });
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

let first: ReturnType<typeof buildTestRepo>;
let firstKeys: { privateKeyPem: string; publicKey: ReturnType<typeof buildTestRepo>['publicKey'] };

test('an empty Extensions page explains the first step and suggests no repository', async () => {
  await go('#/browse/extensions');
  await expect(page.getByRole('heading', { name: 'No extensions yet' })).toBeVisible();
  const main = page.locator('main');
  await expect(main).toContainText('add the address of an extension repository from someone you trust');
  // EXT-7: the app names and links no repository of its own.
  await expect(main.getByRole('link')).toHaveCount(0);
  expect(await main.innerText()).not.toMatch(/https?:\/\//);
  // Developer mode is off, so there is no way to load a folder from here.
  await expect(page.getByRole('button', { name: 'Load from folder' })).toHaveCount(0);
  await shots('empty');

  // The library's first steps lead here too and open the dialog.
  await go('#/library');
  await page.getByRole('link', { name: 'Add a repository' }).first().click();
  await expect(dialog().getByRole('heading', { name: 'Add repository' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog()).toBeHidden();
});

test('adding a repository: it is read first, the unverified key is shown, and trusting it is a choice', async () => {
  site.setRepo(first.files);
  await go('#/browse/extensions');
  await startAdd();
  await dialog().getByLabel('Repository address').fill(site.repoUrl);
  await dialog().getByRole('button', { name: 'Check repository' }).click();

  await expect(dialog()).toContainText('Example Repo · 2 extensions');
  await expect(
    dialog()
      .getByRole('heading', { name: 'Unverified repository' })
      .or(dialog().getByText('Unverified repository', { exact: true })),
  ).toBeVisible();
  await expect(dialog()).toContainText(first.fingerprint);
  await expect(dialog()).toContainText('Matane Anime does not suggest or ship any repository.');
  const trust = dialog().getByRole('checkbox', { name: /Trust this key/ });
  await expect(trust).not.toBeChecked();
  await shots('add-repository');

  await trust.check();
  await dialog().getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog()).toBeHidden();
  // The user lands on what the repository offers.
  await expect(tab('Available')).toHaveAttribute('aria-selected', 'true');
  await expect(offer('example')).toContainText('Example Site');
  await expect(offer('example')).toContainText('Trusted key');
  await expect(offer('mirror')).toContainText('Sample Mirror');
  await expect(tab('Available')).toContainText('2');
  await shots('available');

  await openRepositories();
  const repoRow = page.getByTestId(/^repo-/).first();
  await expect(repoRow).toContainText('Example Repo');
  await expect(repoRow).toContainText(site.repoUrl);
  await expect(repoRow).toContainText(first.fingerprint);
  await expect(repoRow).toContainText('Trusted key');
  await expect(repoRow).toContainText(/Synced (now|\d+ seconds? ago|\d+ minutes? ago)/);
  await expect(repoRow.getByRole('button', { name: 'Stop trusting' })).toBeVisible();
  await shots('repositories');
});

test('adding the same address again, or one that is not a repository, says why', async () => {
  await startAdd();
  await dialog().getByLabel('Repository address').fill(site.repoUrl);
  await dialog().getByRole('button', { name: 'Check repository' }).click();
  await dialog().getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog().getByRole('alert')).toContainText('already added');

  await dialog().getByLabel('Repository address').fill('not an address');
  await dialog().getByRole('button', { name: 'Check repository' }).click();
  await expect(dialog().getByRole('alert')).toContainText('not a valid address');

  await dialog().getByLabel('Repository address').fill(`${site.origin}/nothing-here/`);
  await dialog().getByRole('button', { name: 'Check repository' }).click();
  await expect(dialog().getByRole('alert')).toContainText('404');
  await page.keyboard.press('Escape');
  await expect(dialog()).toBeHidden();
});

test('install shows what is installed and where it comes from, then the extension browses', async () => {
  await tab('Available').click();
  await offer('example').getByRole('button', { name: 'Install Example Site' }).click();
  await expect(dialog().getByRole('heading', { name: 'Install Example Site' })).toBeVisible();
  await expect(dialog()).toContainText('Version 1.0.0 from Example Repo');
  await expect(dialog()).toContainText('Trusted key');
  await expect(dialog()).toContainText('compatible');
  await expect(dialog()).toContainText('English, Indonesian');
  await expect(dialog()).toContainText('SHA-256 verified');
  await expect(dialog()).toContainText('runs in a sandbox');
  // A trusted repository installs without a warning.
  await expect(dialog().getByRole('note')).toHaveCount(0);
  await shots('install-dialog');

  await dialog().getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog()).toBeHidden();
  await expect(tab('Installed')).toHaveAttribute('aria-selected', 'true');
  await expect(row('example')).toContainText('Example Site');
  await expect(row('example')).toContainText('1.0.0');
  await expect(row('example')).toContainText(/EN\s*ID/); // its two language badges, side by side
  await expect(row('example')).toContainText('Example Repo');
  await expect(row('example')).toContainText('Trusted key');
  // Installed, so the offer no longer has an Install button.
  await tab('Available').click();
  await expect(offer('example')).toContainText('Installed');
  await tab('Installed').click();

  await invoke('extensions.setPreference', { extensionId: 'example', key: 'baseUrl', value: site.origin });
  await go('#/browse/sources/example%2Fen');
  await expect(page.locator('a[href*="/anime/"]').first()).toBeVisible();
});

test('the repository publishes 1.1.0: Check repositories finds it and Update all installs it', async () => {
  site.setRepo(
    buildTestRepo({ keyPair: firstKeys, serial: 2, versionBump: '1.1.0', name: 'Example Repo', extensions: packages() })
      .files,
  );
  await go('#/browse/extensions');
  await expect(row('example')).not.toContainText('Update to');
  await openRepositories();
  await panel().getByRole('button', { name: 'Check repositories' }).click();
  await expect(page.getByText('Checked 1 repository')).toBeVisible();

  // The count is a pill next to the title, and Update all a button in the header (no banner any more).
  const banner = page.getByRole('status').filter({ hasText: 'update available' });
  await expect(banner).toContainText('1 update available');
  await expect(row('example')).toContainText('Update to 1.1.0');
  await expect(row('example').getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  await shots('installed-update');

  await page.getByRole('button', { name: 'Update all' }).click();
  await expect(page.getByText('1 extension updated')).toBeVisible();
  await expect(banner).toBeHidden();
  await expect(row('example')).toContainText('1.1.0');
  await expect(row('example')).not.toContainText('Update to');
  expect(
    (await invoke<{ id: string; version: string }[]>('extensions.list')).find((e) => e.id === 'example')?.version,
  ).toBe('1.1.0');
  // Still browsable after the update.
  await go('#/browse/sources/example%2Fen');
  await expect(page.locator('a[href*="/anime/"]').first()).toBeVisible();
});

test('a single extension updates from its own button too', async () => {
  site.setRepo(
    buildTestRepo({ keyPair: firstKeys, serial: 3, versionBump: '1.2.0', name: 'Example Repo', extensions: packages() })
      .files,
  );
  await go('#/browse/extensions');
  await openRepositories();
  await panel().getByRole('button', { name: 'Check repositories' }).click();
  await expect(row('example')).toContainText('Update to 1.2.0');
  await row('example').getByRole('button', { name: 'Update', exact: true }).click();
  await expect(row('example')).toContainText('1.2.0');
  await expect(page.getByText('Example Site updated')).toBeVisible();
});

test('uninstalling asks first, and the sources stay listed as not installed', async () => {
  await row('example').getByRole('button', { name: 'More actions for Example Site' }).click();
  await page.getByRole('menuitem', { name: 'Uninstall Example Site' }).click();
  await expect(dialog().getByRole('heading', { name: 'Uninstall Example Site?' })).toBeVisible();
  await expect(dialog()).toContainText('stay in your library');
  await shot('repo-ui-uninstall-mocha');
  // Cancelling keeps it.
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await expect(row('example')).toBeVisible();

  await row('example').getByRole('button', { name: 'More actions for Example Site' }).click();
  await page.getByRole('menuitem', { name: 'Uninstall Example Site' }).click();
  await dialog().getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect(row('example')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nothing installed yet' })).toBeVisible();

  const sources = await invoke<{ id: string; available: boolean }[]>('sources.list');
  expect(sources.find((s) => s.id === 'example/en')?.available).toBe(false);
  await go('#/browse/sources/example%2Fen');
  await expect(page.getByText('Extension not installed')).toBeVisible();
});

test('an unverified repository warns on every install, and installing from it is still possible', async () => {
  await removeEveryRepoThroughUi();
  await expect(page.getByRole('heading', { name: 'No extensions yet' })).toBeVisible();
  const unverified = buildTestRepo({ name: 'Demo Repo', extensions: packages() });
  site.setRepo(unverified.files);
  await addRepoThroughUi({ trust: false });
  await expect(offer('example')).toContainText('Unverified repository');

  for (const attempt of [1, 2]) {
    await offer('example').getByRole('button', { name: 'Install Example Site' }).click();
    const warning = dialog().getByRole('note').filter({ hasText: 'Unverified repository' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(unverified.fingerprint);
    if (attempt === 1) await shots('install-unverified');
    if (attempt === 1) await dialog().getByRole('button', { name: 'Cancel' }).click();
  }
  await dialog().getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog()).toBeHidden();
  await expect(row('example')).toContainText('Unverified repository');

  // The repository can be trusted afterwards, from its row.
  await openRepositories();
  await expect(page.getByTestId(/^repo-/).first()).toContainText('Unverified');
  await page.getByRole('button', { name: 'Trust this key' }).click();
  await expect(page.getByTestId(/^repo-/).first()).toContainText('Trusted key');
  await tab('Installed').click();
  await expect(row('example')).toContainText('Trusted key');
});

test('removing a repository keeps what was installed from it', async () => {
  await openRepositories();
  await page
    .getByRole('button', { name: /^Remove / })
    .first()
    .click();
  await expect(dialog()).toContainText('stay installed');
  await dialog().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(panel()).toContainText('No repositories yet');
  await tab('Installed').click();
  await expect(row('example')).toContainText('Example Site');
  await invoke('extensions.uninstall', { extensionId: 'example' });
  await expect(row('example')).toHaveCount(0);
});

test('an unsigned repository gets its own warning and no key to trust', async () => {
  const unsigned = buildTestRepo({ name: 'Plain Repo', unsigned: true, extensions: packages() });
  site.setRepo(unsigned.files);
  await go('#/browse/extensions');
  await expect(page.getByRole('heading', { name: 'No extensions yet' })).toBeVisible();
  await startAdd();
  await dialog().getByLabel('Repository address').fill(site.repoUrl);
  await dialog().getByRole('button', { name: 'Check repository' }).click();
  await expect(dialog()).toContainText('Unsigned repository');
  await expect(dialog().getByRole('checkbox')).toHaveCount(0);
  await dialog().getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog()).toBeHidden();
  await expect(offer('example')).toContainText('Unsigned repository');
  await offer('example').getByRole('button', { name: 'Install Example Site' }).click();
  await expect(dialog().getByRole('note').filter({ hasText: 'Unsigned repository' })).toBeVisible();
  await page.keyboard.press('Escape');
  await openRepositories();
  await expect(page.getByTestId(/^repo-/).first()).toContainText('unsigned');
  await expect(page.getByRole('button', { name: 'Trust this key' })).toHaveCount(0);
});

test('18+ and language filters narrow what is offered, and are the same settings as in General', async () => {
  await removeEveryRepoThroughUi();
  const mixed = buildTestRepo({ name: 'Mixed Repo', extensions: [...packages(), ...extras()] });
  needNewerApi(mixed, 'future');
  site.setRepo(mixed.files);
  await addRepoThroughUi({ trust: true });

  // By default: no 18+ and every language.
  await expect(offer('example')).toBeVisible();
  await expect(offer('mirror')).toBeVisible();
  await expect(offer('adult')).toHaveCount(0);
  await expect(tab('Available')).toContainText('3');
  // An entry that needs a newer API is listed with the reason and cannot be installed.
  await expect(offer('future')).toContainText('newer extension API');
  await expect(offer('future').getByRole('button', { name: 'Install Future Site' })).toBeDisabled();

  const nsfw = page.getByRole('switch', { name: 'Show 18+ sources' });
  await nsfw.click();
  await expect(nsfw).toBeChecked();
  await expect(offer('adult')).toContainText('18+');
  await expect(tab('Available')).toContainText('4');
  expect((await invoke<{ showNsfw: boolean }>('settings.get')).showNsfw).toBe(true);

  // Japanese only: the English and Indonesian ones are out.
  await page.getByRole('button', { name: /^Language/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Japanese' }).click();
  await page.keyboard.press('Escape');
  await expect(offer('adult')).toBeVisible();
  await expect(offer('example')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Language/ })).toContainText('Japanese');
  expect((await invoke<{ contentLanguages: string[] }>('settings.get')).contentLanguages).toEqual(['ja']);
  await shots('filtered');

  // General settings show the same choice.
  await go('#/settings/general');
  await expect(page.getByRole('button', { name: 'Japanese', pressed: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'English', pressed: false })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Show 18+ sources' })).toBeChecked();
  await shots('settings-general');
  await page.getByRole('button', { name: 'English', pressed: false }).click();
  await page.getByRole('button', { name: 'Japanese', pressed: true }).click();
  await page.getByRole('switch', { name: 'Show 18+ sources' }).click();
  await expect
    .poll(async () => (await invoke<{ contentLanguages: string[] }>('settings.get')).contentLanguages)
    .toEqual(['en']);

  await go('#/browse/extensions');
  await tab('Available').click();
  await expect(offer('example')).toBeVisible();
  await expect(offer('adult')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Show 18+ sources' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: /^Language/ })).toContainText('English');

  // Back to everything.
  await invoke('settings.set', { contentLanguages: [], showNsfw: false });
  await expect(offer('mirror')).toBeVisible();
});

test('a folder with the same id shows as the reason an offer cannot be installed', async () => {
  await tab('Available').click();
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await expect(offer('example')).toContainText('A folder you loaded already provides this extension');
  await expect(offer('example').getByRole('button', { name: 'Install Example Site' })).toBeDisabled();
  await tab('Installed').click();
  await expect(row('example')).toContainText('Dev');
  await expect(row('example')).toContainText(EXAMPLE);
  await invoke('extensions.removeDevFolder', { folder: EXAMPLE });
  await expect(row('example')).toHaveCount(0);
});

test('developer mode gates Load from folder and the extended log', async () => {
  await go('#/settings/advanced');
  const mode = page.getByRole('switch', { name: 'Developer mode' });
  await expect(mode).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Load from folder' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Extension logs' })).toHaveCount(0);

  await mode.click();
  await expect(page.getByRole('button', { name: 'Load from folder' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Extension logs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Warnings' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Copy' })).toBeDisabled();

  // A folder that cannot load shows up in the log as an error line.
  await invoke('extensions.loadDevFolder', { folder: resolve(ROOT, 'packages/shared') });
  await expect(page.getByTestId('log-panel')).toContainText('packages/shared');
  await page.getByRole('button', { name: 'Errors' }).click(); // off
  await expect(page.getByTestId('log-panel')).toContainText('Nothing logged yet.');
  await page.getByRole('button', { name: 'Errors' }).click(); // on
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('log-panel')).toContainText('packages/shared'); // load errors are not log lines
  await shots('advanced-dev');

  // The page lists a loaded folder, with the button to load more, while dev mode is on.
  await go('#/browse/extensions');
  await expect(page.getByRole('button', { name: 'Load from folder' })).toBeVisible();
  await invoke('extensions.removeDevFolder', { folder: resolve(ROOT, 'packages/shared') });
  await invoke('settings.set', { devMode: false });
  await expect(page.getByRole('button', { name: 'Load from folder' })).toHaveCount(0);
});
