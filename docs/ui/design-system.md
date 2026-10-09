Matane Anime is a desktop app for watching anime from sources the user adds themselves. Its look is Catppuccin, in the same visual language as the Matane reader app: calm, dark by default (Mocha), with a light flavour (Latte) that is checked for legibility. The original Phase 0 mockups used another vocabulary (Figtree, `accent`/`on-accent`, `border-strong`); [ADR 0036](../adr/0036-ui-follows-matane.md) replaced it. Build every screen from the tokens in `tokens.json`; never write a hex value into a screen (the only fixed hexes are the player's `video-*` tokens and `ink`).

## Content fundamentals

- Write the UI in English, in sentence case, in the second person only where an instruction needs it ("Add a repository to get started"). Buttons are verbs: "Continue", "Download", "Retry". No exclamation marks, no emoji.
- Say what happened and what to do next, in one line: "This stream expired. Retry, or switch server." Never "Oops".
- Mockup content is fictional. Use invented anime titles such as "Tsuki no Shiori", "Hoshizora Cafe", "Kaze no Tomoshibi", invented episode names, and generic source names such as "Example Source (EN)". Never use a real series, a real site or real cover art.
- Time and sizes are set in `mono-time` and `mono-small`: `12:43 / 24:10`, `412 MB`, `6.2 MB/s`. Dates are relative ("2 days ago") with the absolute date in a tooltip.
- Status is always a word plus an icon, never colour alone: "Downloaded", "Queued", "Failed", "Unverified".

## Visual foundations

The visual language follows the Matane reader app ([ADR 0036](../adr/0036-ui-follows-matane.md)). Token names are the shadcn/ui ones; the values are Catppuccin. `tokens.json` lists them all.

**Type.** Inter Variable (bundled with `@fontsource-variable/inter`) for everything; the monospace face is the platform's (`font-mono`), used for counts, versions, paths, shortcuts and times. Page title `text-xl font-semibold`; card and section headings `text-sm font-semibold`; body `text-sm`; hints `text-xs text-muted-foreground`; badges `text-[11px]`.

**Surfaces.** `background` for the page, `sidebar` for the sidebar, title bar and bars outside the player, `popover` for menus, dialogs and toasts. Lists and settings groups are `rounded-xl border bg-card/40`; an interactive one goes to `hover:border-input hover:bg-card/70`. Solid `card` is for covers and small tiles. `muted` fills count chips, skeletons and empty-state tiles.

**Text.** `foreground` for primary text; `muted-foreground` for metadata and hints. Accent-coloured text is `text-primary-text`, never `text-primary` (see Themes and legibility).

**Primary (the accent).** `primary` is the user's accent, one of the 14 Catppuccin colours set through `data-accent` (Mauve by default). It fills the primary button, switches, progress fills and the focus ring (solid 2px, offset 2px). Text on a solid fill is `primary-foreground`. One primary button per view. Active navigation is `border-l-2 border-primary bg-primary/15 font-semibold text-primary-text`.

**Accent vs `accent`.** The shadcn `accent` token is *not* the brand colour: it is `surface0`, the hover and highlight background (`hover:bg-accent`, menu `data-[highlighted]:bg-accent`). It equals `card`, `muted` and `secondary`, so a hover on those solid fills is invisible; put hoverable rows on `bg-card/40` instead.

**Borders.** `border` is the 1px hairline for dividers and card outlines. `input` (surface1) outlines fields, checkboxes, switches and secondary buttons (`border-input`); a field sits on `background`, with `border-primary` on focus.

**Status colours.** There are no solid `success`/`warning`/`info` tokens. Borders, fills and icons use the palette utilities (`border-ctp-green/40 bg-ctp-green/10`, `ctp-peach` for warning, `ctp-blue` for info) and `destructive` for errors (`border-destructive/40 bg-destructive/10`). The *text* uses the matching text token: `text-success-text`, `text-warning-text`, `text-info-text`, `text-danger-text` (never `text-ctp-*` or `text-destructive` for text). Status is still a word plus an icon.

**Radius.** `rounded-lg` for buttons, fields and menus; `rounded-md` for badges and menu rows; `rounded-xl` for cards, dialogs and settings groups; `rounded-2xl` for empty and error tiles; `rounded-full` for accent swatches, avatars and progress tracks.

**Spacing.** Page header `px-6 pt-5` (or `px-6 py-4` with `border-b`) with `h1 text-xl font-semibold` and the toolbar pushed right with `ml-auto`. Gap between grid cells 16px; card padding `px-4 py-3.5` for rows, `p-5` for settings groups.

**Shell.** Title bar `h-10` in `sidebar` with a `border-b`: back and forward (ghost icon buttons), breadcrumb, a centred 320px search button with a `Ctrl K` hint, activity and offline indicators, window controls. Sidebar `w-56` (or `w-16` icon-only) with a logo block above a `border-b`, Library, Updates, History, a collapsible Browse group (Sources, Extensions, Global search; open by default, children indented under a `border-l`), Downloads (with a count pill), then Settings and the collapse toggle pinned under a `border-t`. The player is full screen without the sidebar.

**Tabs.** Underline tabs: `border-b-2`, the active one `border-primary text-foreground`; a count chip is `bg-muted`, and `bg-primary/20 text-primary-text` when active.

**Buttons.** `font-medium`, sizes `default h-9`, `sm h-8 text-xs`, `icon size-8`, `icon-sm size-7` (`md` and `lg` remain as aliases). `default` is solid `primary`; `secondary` is `border-input bg-secondary`; `ghost` is muted text with `hover:bg-accent`; `destructive` is an outline in red. `asChild` renders a router link with button styling.

**Badges.** `rounded-md border px-1.5 py-0.5 text-[11px]`; variants `default`, `outline`, `primary`, `success`, `warning`, `danger`, `info`.

**Dialogs and menus.** The overlay is `bg-ctp-crust/70 backdrop-blur-sm`; the dialog is `rounded-xl border bg-popover shadow-2xl` with a `border-b px-5 py-4` header, a scrolling `px-5 py-4` body and a `border-t px-5 py-4` footer (`DialogFooter`). Menus and popovers are `rounded-lg border bg-popover p-1 shadow-xl`, items `h-8 rounded-md px-2` with `data-[highlighted]:bg-accent`.

**Settings.** Each group is a `SettingsCard` (`rounded-xl border bg-card/40 p-5`, `h2 text-sm font-semibold`) of `SettingRow`s (label and hint left, control right, divided by hairlines). Switches are `h-6 w-11`. The theme picker shows a mini swatch per flavor; the accent picker is 14 `size-8` circles with a ring and a check on the selected one.

**Translucency and shadow.** Bars over content use their surface at 90-95% opacity with a 12px backdrop blur; inside the player use `video-scrim`. Only floating layers cast a shadow: `shadow-xl` for menus and toasts, `shadow-2xl` for dialogs and the palette. Cards in the flow have none.

**Covers.** Cover thumbnails are 2:3 with no border and a `bg-muted` placeholder. A card over a cover carries a count badge at top-left (`primary` fill) and a thin progress bar flush at the bottom edge; hovering a cover card turns its border `primary`. In mockups, covers are abstract compositions built from palette accents, never pictures of characters.

**States.** Disabled controls drop to 50% opacity and keep their label. Every list has an empty state (a `size-14 rounded-2xl bg-muted text-primary-text` tile, one line of explanation, one action) and an error state (a red tile, what failed, "Try again"). Loading is `Skeleton` blocks (`animate-pulse bg-muted`), not spinners, except for video buffering.

## Themes and legibility

Mocha is the default; Latte is the second theme (Frappé, Macchiato and AMOLED exist too). Text pairs pass 4.5:1 in Mocha when you follow the rules above. On Latte, a few Catppuccin pairs do not, and they are fixed with variables in `styles.css` rather than by changing the palette:

- **`muted-foreground`** is `subtext0` on the dark flavors and `subtext1` on Latte (`--app-muted`): Latte `subtext0` on base is 4.37:1. This is the one deliberate difference from the Matane reader app.
- **`primary-text`** (`--app-accent-text`) is the accent itself on the dark flavors and, on Latte, the accent mixed 55% with `#11111b`. Plain Latte accents are only 2.3 to 3.5:1 as text on base or on a `primary/15` tint; the mix lifts all 14 to 4.79:1 or better.
- **`primary-foreground`** (`--app-on-accent`) is crust on the dark flavors, base on Latte, and `#11111b` on the 11 Latte accents where base would fail. Blue with base is 4.34:1 and is accepted.
- **`destructive-foreground`** (`--app-on-destructive`) is separate from `primary-foreground` so a pastel accent never changes it: base on Latte red is 4.80:1.
- **Status text** (`success-text`, `warning-text`, `info-text`, `danger-text`; `--app-*-text`) is the palette colour on the dark flavors and, on Latte, the colour mixed with `#11111b` (green 55%, peach 55%, blue 65%, red 75%). Plain Latte green, peach, blue and red measure 2.7, 2.4, 3.8 and 4.1:1 on their own 10% tint; the mixes are 4.79:1 or better on base, mantle, `card` and the tints. Icons, borders and fills keep the plain colour.
- Latte `text` on `input` (surface1) is 4.39:1: keep text inside an input short.
- Marks drawn on a raw accent colour (the swatch check) use `ink` (`#11111b`, 3.45 to 7.17:1 across the 14).

## Iconography

Icons are stroke icons in the Lucide style: 24px grid, 1.75px stroke, round caps and joins, `currentColor`, drawn inline as SVG (never an icon font, never emoji). 16px in rows and menus, 20px in toolbars and the player. Icon-only buttons are at least 36px square on desktop (44px in the player) and carry an `aria-label`. Unfilled icons are `muted-foreground`; the active nav icon is `primary-text`.

## Player chrome

The player lives on `video-stage` in both themes; it does not follow Latte. Top bar `topbar-h` (56px) and bottom bar `bottombar-h` (64px) are `video-scrim` with `video-text` content and a 1px `video-track` hairline.

- Top bar: back button, anime title in `section`, "Ep 12 - episode name" in `small` `video-muted`, then on the right a server and quality button, a settings button and fullscreen.
- Bottom bar: previous episode, play/pause (44px, `video-accent` fill, `video-on-accent` icon), next episode, volume, then the seek bar, `mono-time` readout, speed button.
- Seek bar: 4px track in `video-track`, buffered range in `video-buffered`, played range in `video-accent`, a 12px thumb in `video-accent` that grows on hover.
- When idle, both bars slide away and the cursor hides; a floating `mono-time` pill (`video-scrim`, `radius-full`) stays at the bottom centre. Buffering is a 40px ring in `video-accent` at the centre.
- Errors and the autoplay countdown are centred cards on `video-scrim` with one primary action, "Retry" or "Play now", and one secondary, "Switch server" or "Cancel".
- Burned-in subtitles belong to the video; the player draws none of its own in v1, so keep the bottom 96px of the frame free of UI while the bars are hidden.

## Patterns

- **Lists** are `rounded-xl border bg-card/40` rows with a leading 16:9 thumbnail, a `text-sm font-semibold` title, `text-xs text-muted-foreground` metadata, trailing status and one icon button.
- **Dialogs** use the structure above (header, body, `DialogFooter`) with a right-aligned button pair (secondary, primary). A destructive confirmation is an outline `destructive` button.
- **Progress** uses `primary` on an `input` track; downloads show segments and bytes in the monospace face.
- **Warnings about trust** (an unverified repository) use the `ctp-peach` badge with an icon and the word "Unverified"; trusted repositories show the `ctp-green` badge with "Trusted key".
