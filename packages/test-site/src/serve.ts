// `pnpm --filter @matane-anime/test-site serve`: the fake site on fixed-looking ports, for trying an extension by hand.
import { resolve } from 'node:path';
import { TestSite } from './server.ts';

const site = await TestSite.start({
  mediaDir: resolve(import.meta.dirname, '../../../apps/desktop/e2e/fixtures/media'),
});
console.log(`site: ${site.origin}\ncdn:  ${site.cdnOrigin}\nreferer media and embeds require: ${site.referer}`);
process.on('SIGINT', () => void site.close().then(() => process.exit(0)));
