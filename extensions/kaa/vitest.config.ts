import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The workspace packages export their TypeScript sources under this condition (`dist` is for npm consumers).
  resolve: { conditions: ['matane-source'] },
  ssr: { resolve: { conditions: ['matane-source'] } },
});
