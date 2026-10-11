import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type RepoInfo } from '@matane-anime/shared';
import { TestSite, buildTestRepo, loadBuiltExtension } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Right-click menus of the Extensions page: an installed row, an offered row and a repository card, each running a
// real action against a repository served by the test site.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let app: ElectronApplication;
let page: Page;
let repo: RepoInfo;
let keys: { privateKeyPem: string; publicKey: ReturnType<typeof buildTestRepo>['publicKey'] };

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

const dialog = () => page.getByRole('dialog');
const menu = () => page.getByRole('menu');
const item = (name: string) => menu().getByRole('menuitem', { name, exact: true });
const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const row = (id: string) => page.getByTestId(`extension-${id}`);
const offer = (id: string) => page.getByTestId(`available-${id}`);
const card = () => page.getByTestId(`repo-${repo.id}`);
const panel = () => page.getByTestId('repositories-panel');
const clipboard = () => app.evaluate(({ clipboard: board }) => board.readText());

async function openRepositories(): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Repositories', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(panel()).toBeVisible();
}

/** `extensions/example` and a second, never installed entry. */
function packages() {
  const example = loadBuiltExtension(EXAMPLE);
  return [
    example,
    {
      ...example,
      manifest: {
        ...example.manifest,
        id: 'mirror',
        name: 'Sample Mirror',
        sources: [{ key: 'en', lang: 'en', name: 'Sample Mirror (EN)' }],
      },
    },
  ];
}

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  const built = buildTestRepo({ name: 'Example Repo', extensions: packages() });
  keys = { privateKeyPem: built.privateKeyPem, publicKey: built.publicKey };
  site.setRepo(built.files);
  ({ app, page } = await launchApp());
  await page.waitForSelector('nav', { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.unmaximize();
    window?.setContentSize(1440, 900);
  });
  // The key is not trusted yet, so the repository menu has something to trust.
  repo = await invoke<RepoInfo>('repos.add', { url: site.repoUrl, trustKey: false });
});
test.afterAll(async () => {
  await app?.close();
  await site?.close();
});

test('a repository card offers check, trust, copy URL and remove (last, after a separator)', async () => {
  await go('#/browse/extensions');
  await openRepositories();
  await expect(card()).toContainText('Unverified');

  await card().click({ button: 'right' });
  await expect(menu().getByRole('menuitem')).toHaveText(['Check now', 'Trust this key', 'Copy URL', 'Remove']);
  await expect(menu().getByRole('separator')).toHaveCount(1);

  await item('Trust this key').click();
  await expect(menu()).toBeHidden();
  await expect(card().getByRole('button', { name: 'Stop trusting' })).toBeVisible();

  // Trusted now: the same row turns around.
  await card().click({ button: 'right' });
  await expect(item('Stop trusting')).toBeVisible();
  await expect(item('Trust this key')).toHaveCount(0);
  await item('Check now').click();
  await expect(page.getByText('Example Repo is up to date')).toBeVisible();

  // Copying goes through navigator.clipboard in the renderer and lands on the system clipboard.
  await card().click({ button: 'right' });
  await item('Copy URL').click();
  await expect(page.getByText('Repository URL copied')).toBeVisible();
  expect(await clipboard()).toBe(site.repoUrl);
});

test('Remove in the repository menu asks first, and cancelling keeps the repository', async () => {
  await card().click({ button: 'right' });
  await item('Remove').click();
  await expect(dialog().getByRole('heading', { name: /^Remove / })).toBeVisible();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog()).toBeHidden();
  await expect(card()).toBeVisible();
  // Clicking away from the dialog left the page usable (no stuck pointer-events on the body).
  await card().click({ button: 'right' });
  await expect(menu()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu()).toBeHidden();
});

test('an offered extension installs from its menu and copies its ID', async () => {
  await tab('Available').click();
  await offer('example').click({ button: 'right' });
  await expect(menu().getByRole('menuitem')).toHaveText(['Install', 'Copy extension ID']);
  await item('Install').click();
  await expect(dialog().getByRole('heading', { name: 'Install Example Site' })).toBeVisible();
  await dialog().getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog()).toBeHidden();
  await expect(tab('Installed')).toHaveAttribute('aria-selected', 'true');
  await expect(row('example')).toContainText('Example Site');

  // Installed now: only the copy is left.
  await tab('Available').click();
  await offer('example').click({ button: 'right' });
  await expect(menu().getByRole('menuitem')).toHaveText(['Copy extension ID']);
  await item('Copy extension ID').click();
  await expect(page.getByText('Extension ID copied')).toBeVisible();
  expect(await clipboard()).toBe('example');

  await offer('mirror').click({ button: 'right' });
  await item('Copy extension ID').click();
  expect(await clipboard()).toBe('mirror');
});

test('an installed row shows preferences and logs, updates from its menu, and keeps the more dropdown as it was', async () => {
  await tab('Installed').click();
  await row('example').click({ button: 'right' });
  await expect(menu().getByRole('menuitem')).toHaveText(['Preferences', 'Logs', 'Uninstall']);
  await expect(menu().getByRole('separator')).toHaveCount(1);
  await item('Preferences').click();
  await expect(dialog()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog()).toBeHidden();

  await row('example').click({ button: 'right' });
  await item('Logs').click();
  await expect(dialog()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog()).toBeHidden();

  // The existing dropdown is unchanged.
  await row('example').getByRole('button', { name: 'More actions for Example Site' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Logs', 'Uninstall']);
  await page.keyboard.press('Escape');

  // The repository publishes 1.1.0.
  site.setRepo(
    buildTestRepo({ keyPair: keys, serial: 2, versionBump: '1.1.0', name: 'Example Repo', extensions: packages() })
      .files,
  );
  await invoke('repos.refresh', { id: repo.id });
  await expect(row('example')).toContainText('Update to 1.1.0');
  await row('example').click({ button: 'right' });
  await expect(menu().getByRole('menuitem')).toHaveText(['Preferences', 'Update to 1.1.0', 'Logs', 'Uninstall']);
  await item('Update to 1.1.0').click();
  await expect(page.getByText('Example Site updated')).toBeVisible();
  await expect(row('example')).not.toContainText('Update to');
  await expect
    .poll(
      async () =>
        (await invoke<{ id: string; version: string }[]>('extensions.list')).find((e) => e.id === 'example')?.version,
    )
    .toBe('1.1.0');
});

test('Uninstall in the row menu asks first and then removes the extension', async () => {
  await row('example').click({ button: 'right' });
  await item('Uninstall').click();
  await expect(dialog().getByRole('heading', { name: 'Uninstall Example Site?' })).toBeVisible();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog()).toBeHidden();
  await expect(row('example')).toBeVisible();

  await row('example').click({ button: 'right' });
  await item('Uninstall').click();
  await dialog().getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect(page.getByText('Example Site uninstalled')).toBeVisible();
  await expect(row('example')).toHaveCount(0);
});

test('a dev folder row offers reload and remove folder instead of update and uninstall', async () => {
  await invoke('extensions.loadDevFolder', { folder: EXAMPLE });
  await expect(row('example')).toContainText('Dev');
  await row('example').click({ button: 'right' });
  await expect(menu().getByRole('menuitem')).toHaveText(['Preferences', 'Reload', 'Logs', 'Remove folder']);
  await item('Reload').click();
  await expect(menu()).toBeHidden();
  await expect(row('example')).toContainText('Dev');

  await row('example').click({ button: 'right' });
  await item('Remove folder').click();
  await expect(row('example')).toHaveCount(0);
});

test('Remove in the repository menu removes the repository after confirming', async () => {
  await openRepositories();
  await card().click({ button: 'right' });
  await item('Remove').click();
  await dialog().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(panel()).toContainText('No repositories yet');
});
