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
      'A video player with keyboard shortcuts, quality and server choice, and an autoplay countdown.',
      'Download episodes to watch offline, with a size limit, a queue that survives a restart, and optional download-ahead and delete-after-watching.',
      'Scheduled checks for new episodes, with notifications and a tray icon.',
      'History, and an incognito mode that stops recording what you watch.',
      'A command palette on Ctrl+K (Cmd+K on macOS), a short setup on first launch, and this What’s new window.',
      'Catppuccin themes, an AMOLED black option and 14 accent colors.',
    ],
  },
];
