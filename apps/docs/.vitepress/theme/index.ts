import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import DownloadButton from './DownloadButton.vue';
import ReleaseList from './ReleaseList.vue';
import Shot from './Shot.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  // The home page's download button picks the release file for the visitor's system.
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-actions-after': () => h(DownloadButton) }),
  enhanceApp({ app }) {
    app.component('DownloadButton', DownloadButton);
    app.component('ReleaseList', ReleaseList);
    app.component('Shot', Shot);
  },
} satisfies typeof DefaultTheme;
