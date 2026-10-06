# 7. Toolchain versions pinned for compatibility

Status: Accepted (2026-10-06)

## Context
At setup time TypeScript 7 was not supported by typescript-eslint, and electron-vite 5 supported Vite up to 7.

## Decision
Exact versions, no ranges: Node 24.21 (`.node-version`), pnpm 12.5.1, Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.7, TypeScript 6.0.3, React 19.3, Tailwind 4.3.3, TanStack Router 1.170 and Query 5.104, zod 4.6, Drizzle 0.45.3, better-sqlite3 13.0.3, hls.js 1.7.3, Vitest 5.0.3, Playwright 1.63. Revisit TypeScript and Vite when typescript-eslint and electron-vite support the next majors.

## Notes
- `pnpm-workspace.yaml` lists the packages allowed to run build scripts (`better-sqlite3`, `esbuild`); `electron-winstaller` is denied because installers use NSIS. `minimumReleaseAgeExclude` was added by pnpm for freshly published Radix packages.
- `ELECTRON_RENDERER_URL` must be empty when launching the built app for tests, or it tries to load the dev server.
