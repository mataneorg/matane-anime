import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests sit next to the code. Playwright specs in e2e/ are run by `pnpm e2e`.
    include: ['src/**/*.test.ts'],
  },
});
