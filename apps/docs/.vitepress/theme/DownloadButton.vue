<script setup lang="ts">
import { withBase } from 'vitepress';
import { computed, onMounted, ref } from 'vue';
import {
  defaultOption,
  detectOs,
  optionsOf,
  OS_LABEL,
  type Arch,
  type DownloadOption,
  type Os,
  type ReleaseAsset,
} from './downloads';

// The install page already is the install guide, so it drops that link.
const { guide = true } = defineProps<{ guide?: boolean }>();

const REPO = 'mataneorg/matane-anime';
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LATEST_PAGE = `${RELEASES_PAGE}/latest`;
const CACHE_KEY = 'matane-anime:latest-release';

interface Release {
  tag: string;
  assets: ReleaseAsset[];
}

// Until the release is known, and whenever it cannot be read, the button is a link to the Releases page.
const tag = ref('');
const options = ref<DownloadOption[]>([]);
const selectedId = ref('');

// Only known in the browser, so the server-rendered button names no system (and hydration matches).
const mobile = ref(false);
const failed = ref(false);

const selected = computed(() => options.value.find((o) => o.id === selectedId.value));
const href = computed(() => selected.value?.url ?? LATEST_PAGE);
const title = computed(() =>
  selected.value ? `Download for ${OS_LABEL[selected.value.os]}` : 'Download Matane Anime',
);
const meta = computed(() => {
  if (tag.value) {
    const size = selected.value?.size ? `${Math.round(selected.value.size / 1024 / 1024)} MB` : '';
    return [tag.value, size].filter(Boolean).join(' · ');
  }
  return failed.value ? 'Opens GitHub releases' : 'Latest release';
});
const groups = computed(() =>
  (['windows', 'mac', 'linux'] as Os[])
    .map((os) => ({ os, label: OS_LABEL[os], items: options.value.filter((o) => o.os === os) }))
    .filter((g) => g.items.length > 0),
);

function cached(): Release | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Release) : null;
  } catch {
    return null;
  }
}

function remember(release: Release): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(release));
  } catch {
    // Private window or blocked storage: the next visit asks again.
  }
}

async function latestRelease(): Promise<Release | null> {
  const known = cached();
  if (known) return known;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
    if (!body.tag_name || !Array.isArray(body.assets)) return null;
    const release = {
      tag: body.tag_name,
      assets: body.assets.map(({ name, size, browser_download_url }) => ({ name, size, browser_download_url })),
    };
    remember(release);
    return release;
  } catch {
    return null;
  }
}

/** Chromium can tell Apple silicon from Intel; Safari and Firefox report Intel for both, so they say nothing. */
async function macArch(): Promise<Arch | undefined> {
  const data = (
    navigator as { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> } }
  ).userAgentData;
  try {
    const { architecture } = (await data?.getHighEntropyValues?.(['architecture'])) ?? {};
    if (architecture === 'arm') return 'arm64';
    if (architecture === 'x86') return 'x64';
  } catch {
    // Blocked by a permissions policy: fall back to the default.
  }
  return undefined;
}

onMounted(async () => {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform;
  const os = detectOs(navigator.userAgent, platform, navigator.maxTouchPoints);
  // `detectOs` gives phones and tablets no system; an unknown desktop gets the same, but is not told to switch device.
  mobile.value = os === null && (/android|iphone|ipad|ipod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);

  const release = await latestRelease();
  const found = release ? optionsOf(release.assets) : [];
  if (!release || found.length === 0) {
    failed.value = true;
    return;
  }
  const arch = os === 'mac' ? await macArch() : undefined;

  tag.value = release.tag;
  options.value = found;
  selectedId.value = defaultOption(found, os, arch)?.id ?? '';
});
</script>

<template>
  <div class="download" :class="{ page: !guide }">
    <p v-if="mobile" class="note">Matane Anime is a desktop app. Open this page on your computer to download it.</p>
    <div class="split">
      <a class="main" :href="href" rel="noopener">
        <span class="title">{{ title }}</span>
        <span class="meta" aria-live="polite">{{ meta }}</span>
      </a>
      <div v-if="options.length > 0" class="chev" title="Choose another download">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <select v-model="selectedId" aria-label="Choose another download">
          <option v-if="!selected" value="" disabled>Choose a package</option>
          <optgroup v-for="group in groups" :key="group.os" :label="group.label">
            <option v-for="item in group.items" :key="item.id" :value="item.id">{{ item.label }}</option>
          </optgroup>
        </select>
      </div>
    </div>
    <p class="more">
      <a :href="RELEASES_PAGE">All releases</a>
      <a v-if="guide" :href="withBase('/docs/guides/install')">Install guide</a>
    </p>
  </div>
</template>

<style scoped>
.download {
  margin: 20px 0 0;
  text-align: inherit;
}
.download.page {
  margin: 20px 0 28px;
}
.split {
  display: inline-flex;
  height: 48px;
}
.main,
.chev {
  background-color: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
  transition: background-color 0.2s;
}
.main:hover,
.chev:hover {
  background-color: color-mix(in srgb, #000 14%, var(--vp-c-brand-3));
}
.main:active,
.chev:active {
  background-color: color-mix(in srgb, #000 24%, var(--vp-c-brand-3));
}
.main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 0 20px 0 24px;
  border-radius: 24px;
  text-align: left;
  text-decoration: none;
}
.split:has(.chev) .main {
  border-radius: 24px 0 0 24px;
}
.main:focus-visible,
.chev:has(select:focus-visible) {
  outline: 2px solid var(--vp-c-text-1);
  outline-offset: 2px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
}
.meta {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.25;
  opacity: 0.9;
  font-variant-numeric: tabular-nums;
}
.chev {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  border-radius: 0 24px 24px 0;
  cursor: pointer;
}
.chev::before {
  content: '';
  position: absolute;
  inset: 10px auto 10px 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.4);
  pointer-events: none;
}
.chev select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  appearance: none;
  /* 16px stops iOS from zooming in on focus. */
  font-size: 16px;
  color-scheme: inherit;
}
.chev select:focus-visible {
  outline: none;
}
.chev select :is(option, optgroup) {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.note {
  max-width: 360px;
  margin: 0 auto 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.5;
}
.page .note {
  margin: 0 0 12px;
}
.more {
  display: block;
  /* The links' side margin is pulled back so the first one lines up with the button edge. */
  margin: 6px -8px 0;
  text-align: inherit;
}
.more a {
  display: inline-block;
  margin: 0 8px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 2;
  text-decoration: underline;
  text-decoration-color: var(--vp-c-divider);
  text-underline-offset: 3px;
}
.more a:hover {
  color: var(--vp-c-brand-1);
  text-decoration-color: currentColor;
}

@media (min-width: 960px) {
  .note {
    margin-left: 0;
  }
}
@media (max-width: 479px) {
  .split {
    display: flex;
    width: 100%;
  }
  .main {
    flex: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .main,
  .chev {
    transition: none;
  }
}
</style>
