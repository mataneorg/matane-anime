# Library

The library is the anime you chose to keep, with your progress in each.

## Adding anime

Open **Browse**, pick a source and look through it, or search it. **Browse, Global search** searches every installed source at once and shows the results grouped by source; the command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>) can start the same search.

On an anime's page, **Add to library** keeps it, and removing it works the same way. Covers of library anime are kept on disk, so the library looks the same offline, and they are refreshed when the metadata is refreshed.

## Organising

- **Categories** appear as tabs. An anime can be in several at once; create them and change their order as you like.
- **Display:** comfortable grid, compact grid, covers only or a list. The grid displays have a **Cover size** slider (100 to 280 px), and a badge on each cover shows how many episodes you have not watched. A source's list in Browse has the same choices. The display, size, sort and filters are remembered when you close the app; the category tab and the search text are not.
- **Filter** by unwatched, started, downloaded, status or source, and **sort** by title, last watched, latest episode, date added or number of unwatched episodes. **Reverse order** flips the direction.
- The search box filters the current view by title and alternative titles.
- **Select** several anime to move them to another category, mark them watched, download them or remove them.
- **Continue watching** on a card opens the right episode ([Watching and progress](/guide/watching)).

## Progress and history

Matane Anime remembers where you stopped in every episode. **Continue** on an anime's page opens the episode to watch next, and **History** lists what you watched recently ([Watching and progress](/guide/watching)).

## Incognito

While incognito is on, the app does **not** record watch progress, history or watch sessions. Things you do explicitly still apply: marking an episode watched, changing categories and so on.

- Turn it on from the title bar pill or the command palette (**Toggle incognito**).
- An indicator is always visible while it is on: in the title bar, in the player, and as a banner on History with a **Turn off** button.
- It is kept **in memory only**: it is off again the next time you start the app, and it is not part of a backup.

::: tip
Incognito only controls what the app writes about your watching. It does not hide anything from your network, your sources or your system.
:::

## Statistics

**Statistics** in the sidebar shows how much you watched and what. Pick a period at the top: **7 days**, **30 days**, **12 months** or **All time**.

- **Episodes watched** and **Watch time** for the period, **Library** (how many anime, how many in progress) and your **Streak**: consecutive days with watching, up to today or yesterday, and the best run ever.
- **Activity**: a chart of episodes or watch time, per day for 7 and 30 days and per month for 12 months and all time. **Show as a table** gives the same numbers as text.
- **Genres** (the share of the episodes you watched, top five; an episode of an anime with three genres counts for each), **Most watched** (the five anime you spent the most time on) and **Sources**.

Watch time is the time the player was actually playing. An episode counts as watched here when it is marked watched **and** was opened in the player, so marking a whole list as watched does not change the numbers. Incognito sessions are never counted, and the page stays empty until you have watched something in the player.

Statistics are kept even when you clear the history. **Settings, Data and storage, Statistics** resets watch time, streaks and charts; your library, watched episodes and history stay as they are.

## New episodes

The app checks the anime in your library for new episodes on a schedule you choose (off, every 6, 12 (default), 24 or 48 hours, or weekly). It also checks when the app opens if the interval has passed, and you can check by hand for everything, a category or one anime. Three anime are checked at a time; errors are recorded per anime.

- An episode counts as **new** only if the app found it after you added the anime to the library. Episodes that were already listed when you added it never show up as new.
- Library and category checks skip completed anime (on by default), anime you never watched, and anime with more than N unwatched episodes.
- New episodes appear on the **Updates** page, grouped by date, with actions to watch, download and mark watched, and a badge in the sidebar. A desktop notification groups them (for example "5 new episodes from 3 anime"); clicking it opens the Updates page.
- If a source drops an episode you watched, started, downloaded or have in history, the app keeps it; an empty list from a source never deletes anything.
- Optionally the app can run at login and close to the system tray so checks and downloads continue (on Linux the tray depends on your desktop).

## Moving to another source

If a source goes away or you prefer another, you can move an anime to the same title on another source. Your progress and history carry over.
