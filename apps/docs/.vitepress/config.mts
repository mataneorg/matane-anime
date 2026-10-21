import { defineConfig, type DefaultTheme } from 'vitepress';

const repo = 'https://github.com/mataneorg/matane-anime';

// Shared by every page under /docs/, /download, /changelogs and /contribute, so the reader keeps the same menu
// wherever they are, as on mihon.app.
const docsSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'Download', link: '/download' },
  { text: 'Changelogs', link: '/changelogs' },
  { text: 'Contribute', link: '/contribute' },
  {
    text: 'Getting started',
    items: [
      { text: 'Introduction', link: '/docs/' },
      { text: 'Getting started', link: '/docs/guides/getting-started' },
      { text: 'Install and updating', link: '/docs/guides/install' },
    ],
  },
  {
    text: 'Frequently Asked Questions',
    collapsed: false,
    items: [
      { text: 'General', link: '/docs/faq/general' },
      { text: 'Library', link: '/docs/faq/library' },
      { text: 'Updates', link: '/docs/faq/updates' },
      {
        text: 'Browse',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/docs/faq/browse/' },
          { text: 'Extensions', link: '/docs/faq/browse/extensions' },
        ],
      },
      { text: 'Downloads', link: '/docs/faq/downloads' },
      { text: 'Player', link: '/docs/faq/player' },
      { text: 'Settings', link: '/docs/faq/settings' },
      { text: 'Storage', link: '/docs/faq/storage' },
    ],
  },
  {
    text: 'Guides',
    collapsed: false,
    items: [
      {
        text: 'Troubleshooting',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/docs/guides/troubleshooting/' },
          { text: 'Common issues', link: '/docs/guides/troubleshooting/common-issues' },
          { text: 'Diagnosis', link: '/docs/guides/troubleshooting/diagnosis' },
        ],
      },
      { text: 'Extensions and repositories', link: '/docs/guides/extensions' },
      { text: 'Source migration', link: '/docs/guides/source-migration' },
      { text: 'Library', link: '/docs/guides/library' },
      { text: 'Categories', link: '/docs/guides/categories' },
      { text: 'New episodes', link: '/docs/guides/updates' },
      { text: 'Watching and progress', link: '/docs/guides/watching' },
      { text: 'Player settings', link: '/docs/guides/player-settings' },
      { text: 'Downloads and offline', link: '/docs/guides/downloads' },
      { text: 'Incognito', link: '/docs/guides/incognito' },
      { text: 'Statistics', link: '/docs/guides/statistics' },
      { text: 'Backups', link: '/docs/guides/backups' },
      { text: 'Network', link: '/docs/guides/network' },
      { text: 'Command palette', link: '/docs/guides/command-palette' },
      { text: 'Settings reference', link: '/docs/guides/settings' },
    ],
  },
  {
    text: 'For extension authors',
    items: [
      { text: 'Writing extensions', link: '/extensions/' },
      { text: 'Publishing a repository', link: '/extensions/repository' },
    ],
  },
];

// The site documents the app (GPL-3.0-only, like the rest of apps/). It is built by `pnpm --filter
// @matane-anime/docs docs:build` (and the Docs workflow), never by `pnpm build`. The Docs workflow publishes it to
// GitHub Pages, which serves the repository under its own name, hence `base`.
export default defineConfig({
  base: '/matane-anime/',
  title: 'Matane Anime',
  description: 'A desktop anime player with a library, downloads and a sandboxed extension system.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/png', href: '/matane-anime/favicon.png' }]],
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Download', link: '/download', activeMatch: '^/download' },
      { text: 'Changelogs', link: '/changelogs', activeMatch: '^/changelogs' },
      { text: 'Docs', link: '/docs/guides/getting-started', activeMatch: '^/docs/' },
      { text: 'Contribute', link: '/contribute', activeMatch: '^/contribute' },
      { text: 'Extensions', link: '/extensions/', activeMatch: '^/extensions/' },
      { text: 'Donate', link: 'https://saweria.co/PakdeKun' },
    ],
    sidebar: {
      '/docs/': docsSidebar,
      '/download': docsSidebar,
      '/changelogs': docsSidebar,
      '/contribute': docsSidebar,
      '/extensions/': docsSidebar,
    },
    socialLinks: [
      { icon: 'github', link: repo },
      { icon: 'discord', link: 'https://discord.gg/B9H8JTSpVZ' },
    ],
    editLink: {
      pattern: `${repo}/edit/main/apps/docs/:path`,
      text: 'Help us improve this page',
    },
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
    footer: {
      message: 'Matane Anime does not host, store or distribute any content. Released under the GPL-3.0 license.',
      copyright: 'Copyright © 2026 SukunDev',
    },
  },
});
