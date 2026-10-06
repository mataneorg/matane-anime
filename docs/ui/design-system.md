Matane Anime is a desktop app for watching anime from sources the user adds themselves. Its look is Catppuccin: calm, dark by default (Mocha), with a light flavour (Latte) that is checked for legibility. Build every screen from the tokens in `tokens.json`; never write a hex value into a screen.

## Content fundamentals

- Write the UI in English, in sentence case, in the second person only where an instruction needs it ("Add a repository to get started"). Buttons are verbs: "Continue", "Download", "Retry". No exclamation marks, no emoji.
- Say what happened and what to do next, in one line: "This stream expired. Retry, or switch server." Never "Oops".
- Mockup content is fictional. Use invented anime titles such as "Tsuki no Shiori", "Hoshizora Cafe", "Kaze no Tomoshibi", invented episode names, and generic source names such as "Example Source (EN)". Never use a real series, a real site or real cover art.
- Time and sizes are set in `mono-time` and `mono-small`: `12:43 / 24:10`, `412 MB`, `6.2 MB/s`. Dates are relative ("2 days ago") with the absolute date in a tooltip.
- Status is always a word plus an icon, never colour alone: "Downloaded", "Queued", "Failed", "Unverified".

## Visual foundations

**Surfaces.** The ladder from lowest to highest is `crust`, `mantle`, `base`, `surface0`, `surface1`, `surface2`. Use the semantic names: `background` for the page, `sidebar` for the sidebar, title bar and bars outside the player, `popover` for menus and dialogs, `card` for rows and tiles, `input` for fills of fields and tracks.

**Text.** `foreground` for primary text; `muted-foreground` for metadata, only on `background`, `sidebar` and `popover`. On a `card`, secondary text stays `foreground` at `small`. Never use `subtext0`, `overlay*` as text in Latte.

**Accent.** `accent` (Mauve) is the one accent. It fills primary buttons, marks the active nav item (a 2px `accent` bar plus a tinted background), selects rows, draws the progress fill, and is the focus ring (solid 2px, offset 2px). Text on an accent fill is `on-accent`. One primary button per view. The user may pick another of the 14 Catppuccin accents later: change only the `accent` alias.

**Borders.** `border` is a 1px hairline for dividers on `background`, `sidebar` and `popover`; it is decorative and never the only boundary of a control. Fields, checkboxes and toggles get a 1px `border-strong` outline and sit on `background`, `sidebar` or `popover`, never on a `card`.

**Radius.** `radius-lg` for buttons and fields, `radius-xl` for cards, dialogs and cover thumbnails, `radius-md` for menu rows, `radius-sm` for badges, `radius-full` for count pills and progress tracks.

**Spacing.** Use the `space-*` steps only. Page padding `space-6`; gap between grid cells `space-4`; row padding `space-3`.

**Shell.** Title bar `titlebar-h` (40px) in `sidebar` with a `border` bottom hairline: back and forward, breadcrumb, a centred 320px search field with a `Ctrl K` hint, activity and offline indicators, window controls. Sidebar `sidebar-w` (224px), or `sidebar-w-collapsed` (64px) icon-only, with Library, Updates, History, Browse (Sources, Extensions, Global search), Downloads (with a count pill), then Settings pinned to the bottom. The player is full screen without the sidebar.

**Translucency.** Bars over content use their surface at 90-95% opacity with a 12px backdrop blur. Inside the player use `video-scrim`.

**Shadow.** Only floating layers cast one: `shadow-popover` for menus and toasts, `shadow-dialog` for dialogs and the command palette. Cards in the flow have no shadow.

**Covers.** Cover thumbnails are 2:3, `radius-xl`, with no border. Cards over a cover carry a count badge at top-left (`accent` fill, `on-accent` text, `caption`) and a 3px progress bar flush at the bottom edge. In mockups, covers are abstract compositions built from palette accents (two or three flat shapes), never pictures of characters.

**States.** Hover on a row is `input` at 50%; pressed is `input`. Disabled controls drop to 50% opacity and keep their label. Every list has an empty state (an icon, one line of explanation, one action) and an error state (what failed, source name, Retry). Loading is skeleton blocks in `card`, not spinners, except for video buffering.

## Themes and legibility

Mocha is the default; Latte is the second theme. Text pairs pass 4.5:1 in both themes when you follow the rules above. The pairs that do not, kept exact from the palette and noted on each token:

- Latte `subtext0` on base is 4.37:1: `muted-foreground` uses `subtext1` in Latte instead.
- Latte pastel accents (green 2.96:1, peach 2.64:1, sapphire 2.78:1, yellow 2.31:1) fail as text and sit under 3:1 as marks. `success`, `warning`, `info` therefore always appear with an icon and a word set in `foreground`.
- Latte `text` on `input` (surface1) is 4.39:1: keep text inside an input short and never use a `subtext` colour there.

## Iconography

Icons are stroke icons in the Lucide style: 24px grid, 1.75px stroke, round caps and joins, `currentColor`, drawn inline as SVG (never an icon font, never emoji). 16px in rows and menus, 20px in toolbars and the player. Icon-only buttons are at least 36px square on desktop (44px in the player) and carry an `aria-label`. Unfilled icons are `muted-foreground`; the active nav icon is `accent`.

## Player chrome

The player lives on `video-stage` in both themes; it does not follow Latte. Top bar `topbar-h` (56px) and bottom bar `bottombar-h` (64px) are `video-scrim` with `video-text` content and a 1px `video-track` hairline.

- Top bar: back button, anime title in `section`, "Ep 12 - episode name" in `small` `video-muted`, then on the right a server and quality button, a settings button and fullscreen.
- Bottom bar: previous episode, play/pause (44px, `video-accent` fill, `video-on-accent` icon), next episode, volume, then the seek bar, `mono-time` readout, speed button.
- Seek bar: 4px track in `video-track`, buffered range in `video-buffered`, played range in `video-accent`, a 12px thumb in `video-accent` that grows on hover.
- When idle, both bars slide away and the cursor hides; a floating `mono-time` pill (`video-scrim`, `radius-full`) stays at the bottom centre. Buffering is a 40px ring in `video-accent` at the centre.
- Errors and the autoplay countdown are centred cards on `video-scrim` with one primary action, "Retry" or "Play now", and one secondary, "Switch server" or "Cancel".
- Burned-in subtitles belong to the video; the player draws none of its own in v1, so keep the bottom 96px of the frame free of UI while the bars are hidden.

## Patterns

- **Lists** are `card` rows `space-3` apart, a leading 16:9 thumbnail, `section` title, `small` metadata in `foreground`, trailing status and one icon button.
- **Dialogs** are `popover` with `radius-xl` and `shadow-dialog`, a `title`, one paragraph, then a right-aligned button pair (secondary, primary). A destructive primary is a `danger` fill with `on-accent` text (8.10:1 in Mocha, 4.80:1 in Latte).
- **Progress** uses `accent` on `input`; downloads show segments and bytes in `mono-small`.
- **Warnings about trust** (an unverified repository) use `warning` with an icon and the word "Unverified"; trusted repositories show `success` with "Trusted key".
