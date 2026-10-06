# 3. Typed IPC contract

Status: Accepted (2026-10-06)

## Context
Main, preload and renderer must agree on every message, and the renderer is not trusted with arbitrary access.

## Decision
`packages/shared/src/ipc/` holds the contract:

- `channels.ts` lists the channel names and has no dependencies, so the sandboxed preload can import it without bundling zod. The preload exposes only channels on that list.
- `contract.ts` gives each channel a zod input and output schema; events have a payload schema.
- `registerIpcHandlers` in main rejects calls whose sender is not the app's own page (the packaged file or the dev server) and validates every input before the handler runs.
- A test checks that the contract and the allowlist name exactly the same channels.

Errors cross the boundary as an `AppError` encoded in the message of the thrown `Error` (Electron drops custom error properties) and are decoded again in the renderer.

Channels used only by the spike (`spike.*`) are registered only in development or with `MATANE_SPIKE=1`.

## Consequences
- A new channel is one entry in `channels.ts` and one in `contract.ts`; forgetting either fails a test.
- The renderer uses `ipc.invoke` and `useIpcEvent`, never `ipcRenderer`.
