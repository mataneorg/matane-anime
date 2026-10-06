# 1. pnpm monorepo

Status: Accepted (2026-10-06)

## Context
The app, the types shared by main and renderer, and the extension contract are developed together, and extensions will later be built by people outside this repo.

## Decision
One pnpm workspace: `apps/desktop`, `packages/shared` (domain types, IPC contract, theme constants), `packages/extension-sdk` (the extension contract, types only for now) and `packages/extension-runtime` (empty until phase 1). Packages are `@matane-anime/*`. No build step between packages: they are consumed as TypeScript source.

## Consequences
- One `pnpm install`, one lockfile, one set of scripts at the root (`lint`, `typecheck`, `test`, `e2e`).
- Native modules (`better-sqlite3`) are rebuilt for Electron in the desktop package's `postinstall`.
