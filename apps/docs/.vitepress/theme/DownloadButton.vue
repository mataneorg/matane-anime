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

const REPO = 'mataneorg/matane-anime';
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_KEY = 'matane-anime:latest-release';

interface Release {
  tag: string;
  assets: ReleaseAsset[];
}

// Until the release is known, and whenever it cannot be read, the button is a link to the Releases page.
const tag = ref('');
const options = ref<DownloadOption[]>([]);
const selectedId = ref('');

const selected = computed(() => options.value.find((o) => o.id === selectedId.value));
const href = computed(() => selected.value?.url ?? LATEST_PAGE);
const pick = computed(() => {
  if (options.value.length === 0) return '';
  return selected.value
    ? `${OS_LABEL[selected.value.os]}, ${selected.value.label}\u00a0· `
    : 'Not sure? Use the arrow to pick your system\u00a0· ';
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
      assets: body.assets.map(({ name, browser_download_url }) => ({ name, browser_download_url })),
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
  const release = await latestRelease();
  if (!release) return;
  const found = optionsOf(release.assets);
  if (found.length === 0) return;

  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const os = detectOs(navigator.userAgent, uaData?.platform ?? navigator.platform, navigator.maxTouchPoints);
  const arch = os === 'mac' ? await macArch() : undefined;

  tag.value = release.tag;
  options.value = found;
  selectedId.value = defaultOption(found, os, arch)?.id ?? '';
});
</script>

<template>
  <div class="download">
    <div class="row">
      <a class="button alt" :href="withBase('/guide/getting-started')">Get Started</a>
      <div class="split" :class="{ solo: options.length === 0 }">
        <a class="main" :href="href" rel="noopener">Download{{ tag ? ` ${tag}` : '' }}</a>
        <span v-if="options.length > 0" class="more-pkgs" title="Choose another package">
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <select v-model="selectedId" aria-label="Choose operating system and package">
            <option v-if="!selected" value="" disabled>Choose a package</option>
            <optgroup v-for="group in groups" :key="group.os" :label="group.label">
              <option v-for="item in group.items" :key="item.id" :value="item.id">
                {{ group.label }}, {{ item.label }}
              </option>
            </optgroup>
          </select>
        </span>
      </div>
      <a class="button alt" :href="withBase('/authors/')">Write an extension</a>
    </div>
    <p class="meta" aria-live="polite">
      <span v-if="pick">{{ pick }}</span
      ><a :href="withBase('/guide/getting-started')">Other packages and first-run warnings</a>
    </p>
  </div>
</template>

<style scoped>
/* The slot sits in the hero's text column, after the tagline. Spacing and alignment follow VPHero's `.actions`. */
.download {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 24px;
  max-width: 100%;
}

.row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 100%;
}

@media (min-width: 640px) {
  .download {
    padding-top: 32px;
  }
}

@media (min-width: 960px) {
  .download {
    align-items: flex-start;
  }

  .row {
    justify-content: flex-start;
  }
}

.button.alt {
  box-sizing: border-box;
  display: inline-block;
  max-width: 100%;
  height: 40px;
  padding: 0 20px;
  border: 1px solid var(--vp-button-alt-border);
  border-radius: 20px;
  color: var(--vp-button-alt-text);
  background-color: var(--vp-button-alt-bg);
  font-size: 14px;
  font-weight: 600;
  line-height: 38px;
  white-space: nowrap;
  text-decoration: none;
  transition:
    color 0.25s,
    border-color 0.25s,
    background-color 0.25s;
}

.button.alt:hover {
  border-color: var(--vp-button-alt-hover-border);
  color: var(--vp-button-alt-hover-text);
  background-color: var(--vp-button-alt-hover-bg);
}

/* One pill in two halves: the link downloads, the arrow opens a native select laid transparently over it. */
.split {
  box-sizing: border-box;
  display: inline-flex;
  position: relative;
  height: 40px;
  border: 1px solid var(--vp-button-brand-border);
  border-radius: 20px;
  background: var(--vp-button-brand-bg);
  transition: border-color 0.25s;
}

.split:hover {
  border-color: var(--vp-button-brand-hover-border);
}

.split:has(:focus-visible) {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.main,
.more-pkgs {
  color: var(--vp-button-brand-text);
  transition:
    color 0.25s,
    background-color 0.25s;
}

.main {
  padding: 0 18px 0 20px;
  border-radius: 19px 0 0 19px;
  font-size: 14px;
  font-weight: 600;
  line-height: 38px;
  white-space: nowrap;
  text-decoration: none;
  outline: none;
}

.split.solo .main {
  padding-right: 20px;
  border-radius: 19px;
}

.more-pkgs {
  position: relative;
  display: grid;
  place-items: center;
  width: 38px;
  border-radius: 0 19px 19px 0;
  animation: fade-in 0.2s;
}

.more-pkgs::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: color-mix(in srgb, var(--vp-button-brand-text) 40%, transparent);
}

.more-pkgs select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  appearance: none;
  /* 16px keeps iOS from zooming the page when the picker opens. */
  font-size: 16px;
}

.more-pkgs option,
.more-pkgs optgroup {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-elv);
}

.main:hover,
.more-pkgs:hover,
.main:focus-visible,
.more-pkgs:has(select:focus-visible) {
  color: var(--vp-button-brand-hover-text);
  background: var(--vp-button-brand-hover-bg);
}

.main:active,
.more-pkgs:active {
  background: var(--vp-button-brand-active-bg);
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.meta {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  text-align: center;
  text-wrap: balance;
}

@media (min-width: 960px) {
  .meta {
    text-align: left;
  }
}

.meta a {
  color: inherit;
  text-decoration: none;
}

.meta a:hover,
.meta a:focus-visible {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}

@media (max-width: 639px) {
  .more-pkgs {
    width: 44px;
  }
}

@media (max-width: 379px) {
  .button.alt {
    padding: 0 14px;
  }

  .main {
    padding: 0 12px 0 14px;
  }

  .split.solo .main {
    padding-right: 14px;
  }
}
</style>
