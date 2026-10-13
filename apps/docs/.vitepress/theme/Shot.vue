<script setup lang="ts">
import { withBase } from 'vitepress';

// A screenshot of the app, in Mocha for the dark site and Latte for the light one (made by `pnpm docs:shots`, see
// apps/desktop/scripts/docs-shots.mts). Both are in the page and CSS shows one, so the server-rendered page and
// the hydrated one match whatever the visitor's theme is. Lazy images that are `display: none` are never fetched.
defineProps<{ name: string; alt: string }>();
</script>

<template>
  <figure class="shot">
    <img
      class="light-only"
      :src="withBase(`/img/${name}.latte.webp`)"
      :alt="alt"
      width="1280"
      height="691"
      loading="lazy"
      decoding="async"
    />
    <img
      class="dark-only"
      :src="withBase(`/img/${name}.mocha.webp`)"
      :alt="alt"
      width="1280"
      height="691"
      loading="lazy"
      decoding="async"
    />
  </figure>
</template>

<style scoped>
.shot {
  margin: 20px 0;
}
img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}
.dark-only {
  display: none;
}
:global(.dark) .light-only {
  display: none;
}
:global(.dark) .dark-only {
  display: block;
}
</style>
