import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes SQL migrations to drizzle/. Custom SQL (FTS5 and its triggers) is added
// with `drizzle-kit generate --custom`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
});
