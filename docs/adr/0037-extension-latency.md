# 37. Extension latency: share the page read, give slow mirrors a grace window

Status: Accepted (2026-10-10). Offline tests pass for all 15 extensions in `extensions/`; the live tests and a run in the app against the real sites are described under Consequences.

## Context
The 15 real extensions were written one by one and had the same two sources of waiting:

- **One page, read twice.** `ExtensionService.refreshAnime` runs `getAnimeDetails` and `getEpisodes` together in a `Promise.all` (`main/extensions/service.ts`), and in most extensions both read the same anime page. Every anime opened cost two identical requests, which also spent a token of the extension's rate limit (2/s in most manifests). For a long series the page can be several MB (nimegami, One Piece).
- **A stream list that waits for the slowest host.** `getStreams` resolved every embed with `Promise.all`, so one dead or hung host held the whole answer for its timeout (10 s, plus the network layer's retries) although a working stream was already there.

Smaller costs: embeds read one after another (oploverz), episode lists read page by page (kaa, anizone asked 8 Livewire pages for a 25-episode series), a list of ~700 cards downloaded and parsed again for every page (animeheaven), and a 20 s default timeout for a request that is useless after 10 s (animex).

## Decision
- **Share the read.** Each extension that reads one page for both calls has a small helper in its `site.ts`/`api.ts`:
  - `fetchPageShared(url)` (anoboy, animasu, alqanime, nimegami, anisail): callers asking for a URL while it is in flight share one request; nothing is kept afterwards.
  - `sharedFetch` / `memo` (otakudesu, samehadaku, animeindo, gomunime: 5 s; kaa, anizone, gogoanime: 15 s; animeheaven: 15 s for a page, 30 s for a parsed list): the last 4 to 8 results are kept for a short time. A failed request is never kept. Only the raw response is shared; each caller parses it, because parsed nodes live for one call.
- **Grace window for streams.** `getStreams` still starts every resolver at once and still waits for all of them when they answer normally. Once one has produced a stream, it stops waiting if no other resolver settles for a short time (`GRACE_MS`: 3 s in anoboy, animasu, alqanime, nimegami and anisail; 2.5 s in kaa, animex and gogoanime). Results that arrive later are dropped. animex and gogoanime wait by priority or ranking: the best answer that is in decides when the grace starts. The set of resolvers, the ranking, the dedupe and the 18+ genre filters do not change.
- **Fewer and parallel requests where the site allows it.** oploverz reads its embeds in parallel (the output order is the site's); kaa reads sub and dub together, the pages of one list four at a time and never past `page_count`; anizone builds only the Livewire cursors the page's "N Episodes" count says exist, and falls back on the old count when the number is missing; animex gives each `/sources` request a 10 s timeout; animeindo and gomunime run their gdplayer key derivation about 22% faster (about 2.9 s to 2.3 s of CPU in QuickJS, which blocks the whole runtime).
- **Not changed.** Listings and search (already one request per page), `otakudesu` `getStreams` (already limited by its rate limit and budget), the embed timeouts, and a series page shared between `getStreams` calls (a multi-MB string against the 64 MB heap).

## Consequences
- **A slow mirror can be left out.** One that answers after the grace window, counted from the first working stream, is not in that call's list. The best-ranked stream is always kept, and nothing is dropped while no stream has arrived. Tune `GRACE_MS` per extension.
- **A refresh inside the memo window can show the previous page**: 5 to 15 s (30 s for animeheaven's list). The memos are not cleared by a manual refresh.
- **The requests that lose the race still run** until their own timeout and use rate-limit tokens. Cancelling them when the call returns needs a host change (an abort signal tied to the call); it is not done.
- **The same ~25 lines are copied** into several extensions, as are the grace helpers in kaa, animex and gogoanime. A shared helper in `extension-sdk` would remove it; it was left out of this change so that the SDK's published surface did not change.
- **Measured in the app on 2026-10-10** (Electron, real sites, one run each way, so noise is large): opening an anime went from about 1.9 s to 1.0 s (kaa), 0.7 s to 0.45 s (animeindo) and 0.65 s to 0.33 s (animeheaven); gomunime's first stream, which timed out on the old code in every run, resolved in one of three runs on the new code. Other numbers (popular, search, streams) are within the noise between runs. A direct comparison of kaa's `getStreams` showed no difference (one server, so the grace window does not apply).
- **Live tests** (`LIVE=1`, 2026-10-10): twelve of fifteen pass. anoboy (a timeout), anisail (a Mixdrop host that does not answer) and anizone (the site limits the request rate; a long series came back incomplete) fail on the old code too.
- **The extensions are not in the pnpm workspace** (only `extensions/example` is), so `pnpm test`, `pnpm typecheck` and `--filter` do not run their tests. See "Keeping an extension fast" in [docs/extensions.md](../extensions.md).
