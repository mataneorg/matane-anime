# 36. The UI follows the Matane reader app

Status: Accepted (2026-10-09). Supersedes [ADR 0006](0006-ui-mockups-source-of-truth.md); amends [ADR 0005](0005-catppuccin-theme.md) (token names and fonts).

## Context
The UI was built to the 30 Catppuccin mockups of [ADR 0006](0006-ui-mockups-source-of-truth.md), with its own vocabulary: Figtree and JetBrains Mono, an `accent`/`on-accent` brand colour, `border-strong`, solid `danger`/`success`/`warning`/`info` tokens, pill badges and `rounded-xl bg-card` rows. Matane, the manga reader from the same author, uses the same stack (React 19, Tailwind 4, Catppuccin, radix-ui, cva) with another look, and the two apps should feel like one family.

## Decision
- **The look and the token names come from Matane.** shadcn/ui names (`primary`, `primary-foreground`, `secondary`, `muted`, `accent` = surface0 for hover, `destructive`, `border`, `input` = surface1 for outlines, `card`/`popover` with `-foreground`, `ring`). Status colours are not solid tokens: components use `ctp-green`, `ctp-peach`, `ctp-blue` (and `destructive`) with the pattern `border-X/40 bg-X/10`, and a `*-text` token for the text. The font is Inter Variable (bundled); `font-mono` is the platform's. The renderer's behaviour, routes, copy and i18n do not change; this is a visual change only.
- **Code is rewritten here.** Matane is a reference for patterns; no file or asset (the logo) is copied.
- **The flavors, 14 accents, AMOLED, `data-accent` and the player's `video-*` tokens stay.** The window background is `#1e1e2e`.
- **Deliberate differences, all for contrast on Latte** (the reader app has none of them):
  - `muted-foreground` stays `subtext1` on Latte (`--app-muted`): `subtext0` is 4.37:1 on base.
  - `text-primary-text` (`--app-accent-text`) is used for accent-coloured text. On Latte the accent is mixed 55% with `#11111b`, which brings all 14 accents to 4.79:1 or better on base, mantle and the `primary/15` tint; plain `text-primary` is 2.3 to 3.5:1 for the pastel accents.
  - `text-success-text`, `text-warning-text`, `text-info-text` and `text-danger-text` carry status text (`--app-*-text`): on Latte the colour is mixed with `#11111b` (55%, 55%, 65%, 75%), because the plain colours are 2.4 to 4.1:1 on their own tint; the mixes are 4.79:1 or better. Icons, borders and fills keep `ctp-*` and `destructive`.
  - `destructive-foreground` has its own variable (`--app-on-destructive`): base on Latte red is 4.80:1, and the pastel-accent override of `primary-foreground` would give 3.45:1.
  - `ink` (`#11111b`) is the fixed colour for marks drawn on a raw palette colour (the accent swatch check).
- **The mockup PNGs are historical.** `docs/ui/screens/` shows the previous look and is kept for reference only; it is not re-rendered. `docs/ui/design-system.md` and `docs/ui/tokens/` describe the current UI and are the source of truth for it, next to the PRD. The 30 artboards were not redrawn.

## Consequences
- A new screen is reviewed against `design-system.md` and the running app, and against Matane's equivalent for layout, not against `docs/ui/screens/`.
- `bg-accent` (surface0) is invisible as a hover on `card`, `muted` and `secondary` fills, which are the same colour; hoverable rows sit on `bg-card/40`.
- Tailwind v4 silently drops a class whose token does not exist, so a colour class is checked against the `@theme` block (or `ctp-*`) in review.
- If the mockups are wanted again, they must be redrawn from the current design system first.
