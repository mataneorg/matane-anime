import type { ChangelogEntry } from '@matane-anime/shared';

// The changelog that ships inside the app, newest release first (docs/PRD.md UI-10). "What's new" lists the
// entries that are newer than the version the user last saw, so add the new entry on top for every release.
// Keep it to what the release really does: it is shown to people after an update.

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.0-beta.1',
    date: '2026-10-09',
    items: [
      'Browse, search and open details from the sources you add as extensions. The app ships with none: install them from a repository you trust, in Browse, Extensions.',
      'A library with categories, episode progress, a resume button and a watched threshold you can set.',
      'A video player with keyboard shortcuts you can change in Settings, quality and server choice, and an autoplay countdown of 3, 5 or 10 seconds.',
      'Download episodes to watch offline, with a size limit, a queue that survives a restart, and optional download-ahead and delete-after-watching.',
      'Scheduled checks for new episodes, with notifications and a tray icon.',
      'History, which you can clear from Settings without losing your library, progress or watch time, and an incognito mode that stops recording what you watch.',
      'A choice between the stable and beta update channels, in Settings, About.',
      'A command palette on Ctrl+K (Cmd+K on macOS), a short setup on first launch, and this What’s new window.',
      'Catppuccin themes, an AMOLED black option and 14 accent colors.',
    ],
  },
];
