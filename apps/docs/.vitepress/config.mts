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
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/png', href: '/matane-anime/favicon.png' }]],
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Extensions', link: '/extensions/', activeMatch: '/extensions/' },
      { text: 'Download', link: `${repo}/releases` },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Install', link: '/guide/install' },
          ],
        },
        {
          text: 'Using Matane Anime',
          items: [
            { text: 'Library', link: '/guide/library' },
            { text: 'Watching and progress', link: '/guide/watching' },
            { text: 'Downloads and offline', link: '/guide/downloads' },
            { text: 'Extensions and repositories', link: '/guide/extensions' },
            { text: 'Network (DNS over HTTPS, proxy)', link: '/guide/network' },
            { text: 'Backup and restore', link: '/guide/backup' },
          ],
        },
        { text: 'Help', items: [{ text: 'FAQ and troubleshooting', link: '/guide/faq' }] },
      ],
      '/extensions/': [
        {
          text: 'Extensions',
          items: [
            { text: 'Writing extensions', link: '/extensions/' },
            { text: 'Publishing a repository', link: '/extensions/repository' },
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
      copyright: 'Copyright © 2026 SukunDev',
    },
  },
});
