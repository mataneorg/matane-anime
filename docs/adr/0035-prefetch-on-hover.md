# 35. Fetching an anime ahead when its card is hovered

Status: Accepted (2026-10-09). Covered by a unit test of the scheduling; not yet seen with a real source.

## Context
The first time an anime is opened, its page fetches the details and the episode list from the site once (BRW-6), two requests, so the page opens with an empty episode list for a moment. Later visits read the database and are immediate. Browse knows which anime have never been fetched, and the pointer usually rests on a card for a moment before the click.

## Decision
- **`CatalogAnime.detailsFetched`** says whether the details were fetched at least once (`lastUpdateCheckAt` is set, which doubles as "details last fetched"). Cards of anime that are already fetched do nothing.
- **A card asks for a prefetch** after the pointer or keyboard focus has rested on it for 350 ms (`AnimeCard`), and only while the browser is online. Leaving the card before that cancels it, so moving across a grid fetches nothing.
- **`createPrefetcher`** (`lib/prefetch.ts`, pure and tested) allows two in flight, one try per anime per session, and a failure may be tried again later. A request that was refused because the limit was reached is not counted as done.
- **`refreshAnime`** (`lib/catalog.ts`) wraps `anime.refresh` and fills the query cache. A second call for the same anime while one runs joins it. The anime page uses it too, so a click that comes while the prefetch is still running waits for that one fetch instead of starting another, and one that comes after finds the data already in place and skips the automatic refresh.
- The fetch is the normal `anime.refresh`: same rate limit lane as other page requests, nothing is added to the library, and an error is left for the page to show if the user opens the anime anyway.
- **`capabilities`** asks its three questions to the extension host together (`Promise.all`) instead of one after another.

## Consequences
- Opening an anime from Browse often shows its episodes at once.
- A hovered but never opened anime costs two requests to the site and a few rows in the database. Browse rows are cache and are purged like any other ([0016](0016-library-queries.md)).
- If the site puts up a Cloudflare challenge, a prefetch can start the solver window like any other request would. The same session has normally passed it already by the time Browse lists anything.
