<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

const REPO = 'mataneorg/matane-anime';
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const CACHE_KEY = 'matane-anime:releases';
const FIRST_PAGE = 6;

interface Release {
  tag: string;
  name: string;
  date: string;
  prerelease: boolean;
  url: string;
  // GitHub renders and sanitizes the notes itself (`application/vnd.github.html+json`), so nothing is parsed here.
  html: string;
}

// `null` while loading, `[]` when there is nothing to show; `failed` turns the list into a link to GitHub.
const releases = ref<Release[] | null>(null);
const failed = ref(false);
const showAll = ref(false);

const shown = computed(() => (showAll.value ? releases.value : releases.value?.slice(0, FIRST_PAGE)) ?? []);

function cached(): Release[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Release[]) : null;
  } catch {
    return null;
  }
}

function remember(list: Release[]): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    // Private window or blocked storage: the next visit asks again.
  }
}

interface ApiRelease {
  tag_name?: string;
  name?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  html_url?: string;
  body_html?: string | null;
}

async function load(): Promise<Release[] | null> {
  const known = cached();
  if (known) return known;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github.html+json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiRelease[];
    if (!Array.isArray(body)) return null;
    const list = body
      .filter((r) => r.tag_name && !r.draft)
      .map((r) => ({
        tag: r.tag_name as string,
        name: r.name || (r.tag_name as string),
        date: r.published_at ?? '',
        prerelease: Boolean(r.prerelease),
        url: r.html_url ?? RELEASES_PAGE,
        html: r.body_html ?? '',
      }));
    remember(list);
    return list;
  } catch {
    return null;
  }
}

function dateOf(iso: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
}

onMounted(async () => {
  const list = await load();
  if (list) releases.value = list;
  else failed.value = true;
});
</script>

<template>
  <div class="releases">
    <p v-if="failed" class="note">
      The release notes could not be loaded. Read them on <a :href="RELEASES_PAGE">GitHub</a>.
    </p>
    <p v-else-if="releases === null" class="note" aria-live="polite">Loading releases…</p>
    <p v-else-if="releases.length === 0" class="note">
      No release yet. Watch the <a :href="RELEASES_PAGE">Releases page</a>.
    </p>

    <article v-for="release in shown" :key="release.tag" class="release">
      <header>
        <h2 :id="release.tag">
          <a :href="release.url" rel="noopener">{{ release.name }}</a>
          <span v-if="release.prerelease" class="badge">Pre-release</span>
        </h2>
        <time v-if="release.date" :datetime="release.date">{{ dateOf(release.date) }}</time>
      </header>
      <div v-if="release.html" class="vp-doc notes" v-html="release.html" />
      <p v-else class="note">No notes for this version.</p>
    </article>

    <p v-if="releases && releases.length > FIRST_PAGE && !showAll">
      <button type="button" class="more" @click="showAll = true">Show older versions</button>
    </p>
    <p v-if="releases && releases.length > 0" class="all">
      <a :href="RELEASES_PAGE">All releases on GitHub</a>
    </p>
  </div>
</template>

<style scoped>
.releases {
  margin-top: 20px;
}
.release {
  padding: 20px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.release:first-of-type {
  border-top: 0;
}
h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 1.4rem;
  display: flex;
  align-items: center;
  gap: 10px;
}
h2 a {
  color: var(--vp-c-text-1);
  text-decoration: none;
}
h2 a:hover {
  color: var(--vp-c-brand-1);
}
time {
  display: block;
  margin-top: 2px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.badge {
  padding: 1px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.notes {
  margin-top: 12px;
}
.note {
  color: var(--vp-c-text-2);
}
.more {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  font-weight: 500;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.2s;
}
.more:hover {
  border-color: var(--vp-c-brand-1);
}
.all {
  margin-top: 8px;
}
</style>
