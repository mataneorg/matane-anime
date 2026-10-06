# 5. Catppuccin theme

Status: Accepted (2026-10-06)

## Context
The UI is designed in Catppuccin (docs/ui/design-system.md).

## Decision
Tailwind v4 with `@catppuccin/tailwindcss`, which provides the four flavors (`mocha` default, `macchiato`, `frappe`, `latte`) as classes. The app only uses semantic tokens (`background`, `foreground`, `muted-foreground`, `card`, `border`, `border-strong`, `accent`, `on-accent`, `success`/`warning`/`danger`/`info`), mapped per flavor; `muted-foreground` is `subtext1` in Latte for contrast. The `video-*` tokens are the same in every flavor.

- `amoled` is a class on top of a dark flavor and has no effect in Latte.
- The accent is one of the 14 Catppuccin colors, set through `data-accent`.
- `system` follows `prefers-color-scheme` (Mocha or Latte).
- Fonts are Figtree and JetBrains Mono from `@fontsource`, bundled, so the app works offline and under the CSP.
- The theme logic (`resolveFlavor`, `isAmoledActive`) lives in `packages/shared` and is unit tested.

## Consequences
- Components never use raw palette colors.
- The first paint already has the right theme: the root route renders nothing until the stored settings have loaded.
