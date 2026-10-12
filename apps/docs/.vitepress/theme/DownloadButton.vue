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
      <a class="button" :href="href" rel="noopener">Download{{ tag ? ` ${tag}` : '' }}</a>
      <select v-if="options.length > 0" v-model="selectedId" class="select" aria-label="Operating system and package">
        <option v-if="!selected" value="" disabled>Choose a package</option>
        <optgroup v-for="group in groups" :key="group.os" :label="group.label">
          <option v-for="item in group.items" :key="item.id" :value="item.id">
            {{ group.label }}, {{ item.label }}
          </option>
        </optgroup>
      </select>
    </div>
    <a class="more" :href="withBase('/guide/getting-started')">Other packages and first-run warnings</a>
  </div>
</template>

<style scoped>
/* The slot sits in the hero's text column, above the row of actions. Spacing and alignment follow VPHero's `.actions`. */
.download {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
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

.button,
.select {
  box-sizing: border-box;
  height: 40px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  line-height: 38px;
  white-space: nowrap;
  transition:
    color 0.25s,
    border-color 0.25s,
    background-color 0.25s;
}

.button {
  display: inline-block;
  padding: 0 20px;
  border: 1px solid var(--vp-button-brand-border);
  color: var(--vp-button-brand-text);
  background-color: var(--vp-button-brand-bg);
  text-decoration: none;
}

.button:hover {
  border-color: var(--vp-button-brand-hover-border);
  color: var(--vp-button-brand-hover-text);
  background-color: var(--vp-button-brand-hover-bg);
}

.button.alt,
.select {
  max-width: 100%;
  padding: 0 14px;
  border: 1px solid var(--vp-button-alt-border);
  color: var(--vp-button-alt-text);
  background-color: var(--vp-button-alt-bg);
  cursor: pointer;
}

.button.alt {
  padding: 0 20px;
}

.button.alt:hover,
.select:hover {
  border-color: var(--vp-button-alt-hover-border);
  color: var(--vp-button-alt-hover-text);
  background-color: var(--vp-button-alt-hover-bg);
}

.more {
  padding-left: 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.more:hover {
  color: var(--vp-c-brand-1);
}
</style>
