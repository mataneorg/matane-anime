// Picks the package for a visitor out of a GitHub release. Pure functions: the component feeds them the browser's
// facts and the release's assets, so nothing here touches `navigator` or `fetch`.

export type Os = 'windows' | 'mac' | 'linux';
export type Arch = 'arm64' | 'x64';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface DownloadOption {
  id: string;
  os: Os;
  label: string;
  url: string;
}

// The names come from `artifactName` in apps/desktop/electron-builder.yml. Blockmaps and latest*.yml are the
// updater's files and match nothing here.
const PACKAGES: { id: string; os: Os; label: string; pattern: RegExp }[] = [
  { id: 'win-installer', os: 'windows', label: 'Installer (.exe)', pattern: /-win-x64\.exe$/ },
  { id: 'win-portable', os: 'windows', label: 'Portable (.exe)', pattern: /-win-x64-portable\.exe$/ },
  { id: 'mac-arm64', os: 'mac', label: 'Apple silicon (.dmg)', pattern: /-mac-arm64\.dmg$/ },
  { id: 'mac-x64', os: 'mac', label: 'Intel (.dmg)', pattern: /-mac-x64\.dmg$/ },
  { id: 'linux-appimage', os: 'linux', label: 'AppImage', pattern: /-linux-x86_64\.AppImage$/ },
  { id: 'linux-deb', os: 'linux', label: 'Debian, Ubuntu (.deb)', pattern: /-linux-amd64\.deb$/ },
  { id: 'linux-rpm', os: 'linux', label: 'Fedora, openSUSE (.rpm)', pattern: /-linux-x86_64\.rpm$/ },
];

export const OS_LABEL: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

export function optionsOf(assets: ReleaseAsset[]): DownloadOption[] {
  const options: DownloadOption[] = [];
  for (const spec of PACKAGES) {
    const asset = assets.find((a) => spec.pattern.test(a.name));
    if (asset) options.push({ id: spec.id, os: spec.os, label: spec.label, url: asset.browser_download_url });
  }
  return options;
}

/** Phones and tablets get no default: the desktop packages are no use there. */
export function detectOs(userAgent: string, platform = '', touchPoints = 0): Os | null {
  if (/android|iphone|ipad|ipod/i.test(userAgent)) return null;
  const haystack = `${platform} ${userAgent}`;
  if (/win/i.test(platform) || /windows/i.test(userAgent)) return 'windows';
  // iPadOS reports a Mac; a Mac has no touch screen.
  if (/mac/i.test(haystack)) return touchPoints > 1 ? null : 'mac';
  if (/linux|x11|cros/i.test(haystack)) return 'linux';
  return null;
}

const DEFAULT_ID: Record<Os, string> = {
  windows: 'win-installer',
  mac: 'mac-arm64',
  linux: 'linux-appimage',
};

/** Which option to preselect. `arch` is only known on Chromium; elsewhere a Mac is assumed to be Apple silicon. */
export function defaultOption(options: DownloadOption[], os: Os | null, arch?: Arch): DownloadOption | undefined {
  if (!os) return undefined;
  const id = os === 'mac' && arch === 'x64' ? 'mac-x64' : DEFAULT_ID[os];
  return options.find((o) => o.id === id) ?? options.find((o) => o.os === os);
}
