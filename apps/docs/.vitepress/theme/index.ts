import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import DownloadButton from './DownloadButton.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  // The home page's download button picks the release file for the visitor's system.
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-actions-after': () => h(DownloadButton) }),
  enhanceApp({ app }) {
    app.component('DownloadButton', DownloadButton);
  },
} satisfies typeof DefaultTheme;
