# Introduction

Matane Anime (またね, Japanese for "see you later") is an open-source anime player for the desktop: close it now and pick up on the same episode next time. It keeps a library with your watch progress, plays HLS and MP4 streams, downloads episodes for offline viewing and tells you when new episodes come out.

::: warning Matane Anime hosts no content
The app does not host, store or distribute any anime, and ships with no sources, repositories or keys. Sources are provided by **extensions**, small programs that read a website for you. The developers are not affiliated with anything that third-party extensions provide. See the [FAQ](/docs/faq/general).
:::

::: info Unsigned builds
The Windows and macOS builds are not code-signed yet, so your system warns you on first run: see [how to get past it](/docs/guides/install#first-run-warnings).
:::

## How it fits together

- **Extensions** turn a website into one or more **sources**. You add them from a **repository** you choose yourself, a signed list of extensions ([Extensions and repositories](/docs/guides/extensions)).
- **Browse** a source, open an anime and **add it to your library**. Your progress is remembered, and the library checks for new episodes by itself ([Library](/docs/guides/library)).
- The **player** picks the best stream, falls back to another one when it fails and marks episodes watched as you go ([Watching and progress](/docs/guides/watching)).
- **Downloads** keep episodes on your computer ([Downloads and offline](/docs/guides/downloads)).
- Everything stays on your computer. The only requests are to the sources you use, the repositories you added, and GitHub for updates. There is no telemetry.

## First start

<Shot name="library" alt="The library" />

A short setup asks for the language, theme, the language of the content you watch, the download folder and shows the player controls. You can run it again from **Settings, About, Run setup again**.

Press <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere for the command palette: pages, your library, continue watching and actions.

## Appearance

The interface uses the [Catppuccin](https://catppuccin.com) palette. In **Settings, General**:

- **Theme:** Mocha (the default, dark), Macchiato, Frappé (dark), Latte (light), or match the system.
- **AMOLED:** a darker variant of the dark themes with true black backgrounds.
- **Accent color:** one of 14 Catppuccin colors. Text on an accent uses a dark color so it stays readable.
- **Language:** English or Indonesian; by default the system language.

The animations respect your system's _reduce motion_ setting, and keyboard focus is always visible.

## Where to go next

- New here? Follow [Getting started](/docs/guides/getting-started).
- Something not working? See [Troubleshooting](/docs/guides/troubleshooting/) and the [FAQ](/docs/faq/general).
- Every option explained: [Settings reference](/docs/guides/settings).
- Want to write a source? Read [Writing extensions](/extensions/).
