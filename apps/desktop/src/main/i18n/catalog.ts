// What the main process says in the user's language: OS notifications and the tray menu. The renderer's own
// catalogs (renderer/src/i18n/locales) are not reachable from here, so these two languages live in their own
// typed tables. Plural forms are `<key>_one` and `<key>_other`; a language with one form repeats it.

export const en = {
  'notify.newEpisodes.title': 'New episodes',
  'notify.newEpisodes.ofAnime_one': '{{count}} new episode of {{title}}',
  'notify.newEpisodes.ofAnime_other': '{{count}} new episodes of {{title}}',
  'notify.newEpisodes.fromMany_one': '{{count}} new episode from {{anime}} anime',
  'notify.newEpisodes.fromMany_other': '{{count}} new episodes from {{anime}} anime',
  'tray.tooltip': 'Matane Anime',
  'tray.open': 'Open Matane Anime',
  'tray.check': 'Check for updates now',
  'tray.pause': 'Pause downloads',
  'tray.resume': 'Resume downloads',
  'tray.quit': 'Quit',
} as const;

export type CatalogKey = keyof typeof en;

export const id: Record<CatalogKey, string> = {
  'notify.newEpisodes.title': 'Episode baru',
  'notify.newEpisodes.ofAnime_one': '{{count}} episode baru dari {{title}}',
  'notify.newEpisodes.ofAnime_other': '{{count}} episode baru dari {{title}}',
  'notify.newEpisodes.fromMany_one': '{{count}} episode baru dari {{anime}} anime',
  'notify.newEpisodes.fromMany_other': '{{count}} episode baru dari {{anime}} anime',
  'tray.tooltip': 'Matane Anime',
  'tray.open': 'Buka Matane Anime',
  'tray.check': 'Cek pembaruan sekarang',
  'tray.pause': 'Jeda unduhan',
  'tray.resume': 'Lanjutkan unduhan',
  'tray.quit': 'Keluar',
};
