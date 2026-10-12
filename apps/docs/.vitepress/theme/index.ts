import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import DownloadButton from './DownloadButton.vue';

// The hero's own actions are plain links; the download button needs a select, so it goes in through a slot.
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-info-after': () => h(DownloadButton) }),
};
