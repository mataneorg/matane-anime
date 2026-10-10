import { defineConfig } from 'vitepress';

const repo = 'https://github.com/mataneorg/matane-anime';

// The site documents the app (GPL-3.0-only, like the rest of apps/). It is built by `pnpm --filter
// @matane-anime/docs docs:build` (and the Docs workflow), never by `pnpm build`. The Docs workflow publishes it to
// GitHub Pages, which serves the repository under its own name, hence `base`.
export default defineConfig({
  base: '/matane-anime/',
  title: 'Matane Anime',
  description: 'A desktop anime player with a library, downloads and a sandboxed extension system.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Authors', link: '/authors/' },
      { text: 'FAQ', link: '/faq' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [{ text: 'Install', link: '/guide/getting-started' }],
        },
        {
          text: 'Using the app',
          items: [
            { text: 'Library', link: '/guide/library' },
            { text: 'Watching and progress', link: '/guide/watching' },
            { text: 'Downloads and offline', link: '/guide/downloads' },
            { text: 'Statistics', link: '/guide/statistics' },
            { text: 'Updates', link: '/guide/updates' },
            { text: 'Extensions and repositories', link: '/guide/extensions' },
            { text: 'Network', link: '/guide/network' },
            { text: 'Incognito', link: '/guide/incognito' },
            { text: 'Backup and restore', link: '/guide/backup' },
            { text: 'Keyboard shortcuts', link: '/guide/shortcuts' },
            { text: 'Themes', link: '/guide/themes' },
          ],
        },
        {
          text: 'More',
          items: [
            { text: 'Packages and updates', link: `${repo}/blob/main/docs/packaging/README.md` },
            { text: 'FAQ and disclaimer', link: '/faq' },
          ],
        },
      ],
      '/authors/': [
        {
          text: 'For authors',
          items: [
            { text: 'Overview', link: '/authors/' },
            { text: 'Writing an extension', link: '/authors/writing-extensions' },
            { text: 'Extension repositories', link: '/authors/repositories' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/apps/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    footer: {
      message: 'Matane Anime does not host, store or distribute any content. Released under the GPL-3.0 license.',
    },
  },
});
