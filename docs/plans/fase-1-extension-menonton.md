# Plan: Fase 1 (Extension dan menonton) Matane Anime

## Context

Fase 0 selesai: monorepo, shell Catppuccin, IPC bertipe (zod), seluruh skema SQLite §9, i18n EN/ID, CI, ADR 0001–0009, dan spike pemutaran (HLS TS/AES/fMP4, URI absolut, seek MP4 `Range` 206 lewat `anime://`; lulus 11 tes di Linux). Fase 1 (PRD §13) membuat app **benar-benar bisa dipakai menonton**: extension berjalan di sandbox QuickJS, browse → detail → putar episode, dengan pemilihan stream, probe, dan fallback.

Acuan pola (hanya dibaca, ditulis ulang untuk anime): rencana dan kode Matane di `manga-reader/` (`docs/plans/fase-1-extension-membaca.md`, `packages/extension-{sdk,runtime,cli}`, `apps/desktop/src/main/{extensions,network}`, ADR 0003/0012/0013) serta PRD §6.1–6.4, §6.10, §7, §8.3.

Keputusan:
- **5 milestone**, berhenti di tiap checkpoint untuk review dan commit olehmu (tidak ada commit otomatis).
- **Tanpa extension, repo, atau kunci bawaan** (EXT-7). Satu-satunya cara memuat extension di Fase 1 adalah **folder dev** (EXT-10). Repo, signing, install/update/uninstall adalah Fase 4.
- Extension uji ada di repo tetapi **tidak dikirim bersama app** dan menyasar **situs anime tiruan** di loopback (PRD §13). Extension nyata pertama ditulis pemilik produk di repo terpisah setelah SDK jadi; repo app tidak merujuknya.
- `extension-runtime` dan `extension-cli` berlisensi MIT (seperti SDK); app tetap GPL-3.0-only.

Di luar cakupan Fase 1: library/kategori, progress, resume, history, "lanjut nonton" (Fase 2, `WatchService`), global search (Fase 2), download dan update checker (Fase 3), repo/signing/`migrateUrl` (Fase 4), DoH/proxy/UA kustom, ubah shortcut, command palette (Fase 5). Pemutar Fase 1 **tidak menyimpan posisi**.

Catatan risiko yang dibawa dari Fase 0: ADR 0008 baru terbukti di Linux. Verifikasi Windows/macOS lewat `spike.yml` ditunda sampai repo GitHub ada. Kode transport tetap terisolasi di `playback/` agar varian B (custom loader hls.js) bisa dipasang bila hasil 3 OS mengharuskannya.

---

## Milestone 1a: SDK, runtime, CLI, situs tiruan, extension uji (tanpa Electron)

**`packages/extension-sdk`** (MIT, tambahan atas `types.ts`)
- `Filter` (text, select, checkbox, tristate, sort, group, header, separator), `FilterState`, `Preference` (switch/select/multiselect/text), error bertipe (`NetworkError`, `HttpError(status)`, `CloudflareError`, `RateLimitedError`, `NotFoundError`, `ParseError`; EXT-12).
- Skema `manifest.json` (zod): `id`, `name`, `version`, `apiVersion`, **`type: 'anime'`** (EXT-3, ditolak bila lain), `nsfw`, `rateLimit`, `sources[{key,lang,name}]`. Tanpa `domains` (allowlist dibuang, PRD EXT-3).
- `defineExtension`, deklarasi global sandbox (`http`, `html`, `storage`, `prefs`, `log`, `crypto`, `base64`, `utf8`, `timers`) untuk autocomplete.

**`packages/extension-runtime`** (MIT)
- `ExtensionRuntime` di atas `quickjs-emscripten` (pin versi seperti Matane, 0.32.0): satu runtime per extension, memori 64 MB, kode sinkron maks 2 s (interrupt handler), timeout panggilan 30 s (`getEpisodes` 60 s) (EXT-1/2). Data masuk dan keluar sandbox sebagai JSON; promise di-resolve oleh host.
- Host API lewat antarmuka `HostApi` (agar runtime sama dipakai app dan CLI): `http`, `storage`, `prefs`, `log`, `crypto` (md5/sha1/sha256/`aesDecrypt`), `base64`, `utf8`, `timers.sleep` (EXT-11). Tanpa `require`, `fetch`, `process`, file.
- `html` memakai **cheerio** di host: `html.load` mengembalikan handle, objek DOM tetap di host dan dibuang saat panggilan selesai.
- Error bertipe melintasi batas sandbox dan bisa dibedakan di sisi pemanggil.
- **Test sandbox (Vitest)**, semuanya harus gagal dengan aman: `require`/`process`/`fetch` tak tersedia, loop tak berujung diputus, batas memori, timeout, plus test jembatan promise dan handle `html`. Catatan dari Matane: quickjs-emscripten 0.32 punya bug `executePendingJobs` saat memori WASM tumbuh; buat regression test dan buang context liar setelah tiap job.

**`packages/test-site`** (baru, private): situs anime tiruan di loopback, dipakai CLI, test, dan e2e. Halaman HTML popular/latest/search/detail, daftar episode, halaman embed yang mengarah ke m3u8/mp4, `Referer` wajib, mode Cloudflare tiruan (challenge → cookie) untuk uji NET-5. Media dari `apps/desktop/e2e/fixtures/media`. Sumber awal: `playback/spike/server.ts` (tetap ada untuk spike).

**`extensions/example`** (private, workspace `extensions/*`, tidak dikirim): extension contoh yang memakai semua fitur kontrak (popular, latest, search + filter, detail, episode, `getStreams` multi-langkah halaman → embed → m3u8, `resolveUrl`, `getWebUrl`, preference). `baseUrl` bisa diarahkan ke port situs tiruan.

**`packages/extension-cli`** (bin `ma-ext`, MIT; commander + esbuild 0.28.2; EXT-18 tanpa `repo`)
- `create <id>` (template), `build [dir]` (esbuild → ES2020 IIFE, validasi: tanpa `import` tersisa, manifest valid, output `dist/{index.js,manifest.json,icon.png}`), `test [dir]` (runtime sama, http lewat `fetch` Node; rantai popular → detail → episode → streams), `bench` (durasi dan memori per panggilan).

**Checkpoint 1a:** `ma-ext test extensions/example` berhasil terhadap situs tiruan; test sandbox dan test fixture hijau.

---

## Milestone 1b: Network layer, host extension, registry, repositori DB, IPC

**Network layer** (`apps/desktop/src/main/network/`)
- `ExtensionFetcher` di atas `net.request` dengan session `persist:ext-<id>`; http(s) saja, diperiksa di **setiap redirect** (`redirect` event) (NET-1). Catatan Matane: `net.fetch` menolak `redirect: 'manual'`.
- Rate limit **token bucket** per extension (default 10/detik dari manifest) dan **bucket media terpisah** (default 30/detik) untuk segmen/mp4 (NET-2). Timeout 20 s, retry untuk error jaringan dan 5xx/429 dengan `Retry-After` (NET-3). UA: UA extension → global → Chrome Electron tanpa token "Electron" (NET-4).
- **Cloudflare** (NET-5): deteksi (`cf-mitigated`/halaman challenge) → `BrowserWindow` tersembunyi di partition extension dengan UA sama → tampil bila ±10 s belum selesai → ulangi; request lain menunggu satu penyelesaian yang sama; batas 2 menit. Diuji dengan mode challenge tiruan di `test-site`.
- Deteksi offline (`net.isOnline()` + event `network.status`) dan indikator di title bar (NET-7, UI-1).
- **Pakai ulang `installHeaderBridge`** (ADR 0008): sekarang hanya mengganti marker di `session.defaultSession`; ubah menjadi per-session (`installHeaderBridge(session)`) karena `Referer`/`Origin` ditolak Chromium dari main. Pindahkan ke `network/`.

**Host extension** (`apps/desktop/src/main/extensions/`, `src/extension-host/index.ts`)
- `utilityProcess.fork`, entry tambahan di `electron.vite.config.ts` (`rollupOptions.input`, pola Matane). RPC lewat `MessagePort`: main → host `call`; host → main `http|storage|prefs|log`. Host crash → restart dan panggilan yang berjalan gagal dengan `host_crashed`. Runtime dimuat lazy dan dibongkar saat idle (EXT-1).
- **Registry (hanya folder dev)**: `extensions.loadDevFolder` (folder `dist/` atau `manifest.json` + `index.js`), watch + hot reload, folder yang belum dibangun tetap terdaftar dengan error; jalur folder disimpan di `settings` dan dimuat saat start. Upsert ke `extensions` dan `sources` (id `<extensionId>/<key>`; EXT-4). Panel log extension (ring buffer + event) (EXT-10). `storage`/`prefs` ke `extension_storage`/`extension_prefs`.

**Repositori DB** (`db/repositories/`)
- `sources`, `anime` (upsert `(source_id,url)` tanpa menimpa `inLibrary`/`addedAt`), `episodes` (upsert `(anime_id,url)`, `fetchedAt` hanya untuk baris baru, `sourceOrder`, episode hilang ditandai `sourceMissing`; daftar kosong dari source **tidak mengubah apa pun**; aturan hapus lengkap UPD-5 menunggu Fase 3).
- Setiap penulisan memancarkan event **`db.changed`** bertag entitas (PRD §8.2).

**Tambahan IPC** (`packages/shared/src/ipc/{channels,contract}.ts`, zod): `extensions.{list,loadDevFolder,reload,logs}`, `sources.{list,filters,browse,resolveUrl}`, `anime.{get,refresh}`, `episodes.list`, `requests.cancel` (dari `AbortSignal` TanStack Query); event `db.changed`, `network.status`, `extensions.log`, `cloudflare.status`. Tes kontrak ikut menjaga `channels.ts` ≡ `contract.ts`.

**Checkpoint 1b:** dari DevTools `window.api.invoke('sources.browse', …)` mengembalikan data situs tiruan lewat extension uji dan barisnya tersimpan; mematikan proses host tidak menjatuhkan app; test rate limiter, redirect non-http, header bridge per session, sinkronisasi episode, RPC, dan Cloudflare tiruan hijau.

---

## Milestone 1c: UI Browse, detail, Extensions

Acuan mockup (`docs/ui/screens`): `04-browse`, `02-detail`, `02b-detail-error`, `06-extensions` (hanya bagian "terpasang"; repo dan install dialog = Fase 4), `10-settings-*` (Advanced).
- **Sources** `/browse/sources` (daftar, bahasa, pin) dan **Browse source** `/browse/sources/$sourceId`: Popular/Latest/Search, `useInfiniteQuery`, grid cover, skeleton, error + coba lagi + Cloudflare "Verifikasi", panel filter otomatis dari `getFilters()` (EXT-14), "Buka dari URL" (`resolveUrl`, BRW-3), offline menonaktifkan Browse dengan keterangan (BRW-7), NSFW disembunyikan default (EXT-15).
- **Detail** `/anime/$animeId` (BRW-4/5/6): header, judul alternatif, genre, status, tombol Mulai nonton, Buka di browser, Refresh, daftar episode dengan sort dan varian (episode bernomor sama dikelompokkan, PRG-5); fetch pertama otomatis; error mempertahankan data lama. Virtualisasi dengan TanStack Virtual untuk daftar panjang. Tombol "Tambah ke library", "Lanjut", progres, unduhan ada tetapi nonaktif (Fase 2/3).
- **Extensions** `/browse/extensions`: daftar terpasang dengan badge Dev, status/error, Reload; **Settings → Advanced** (mode dev): "Load extension from folder", panel log extension.
- Kunci query dan pemetaan `db.changed` → invalidasi dipusatkan di `lib/ipc.ts`/`lib/query.ts` (pola `localQueryDefaults`, data remote memakai default retry 2).
- Semua string baru ke `en.json` dan `id.json`; bandingkan screenshot Mocha dan Latte dengan mockup.

**Checkpoint 1c:** muat `extensions/example` lewat folder dev, browse, filter, infinite scroll, buka detail dan daftar episode; screenshot dibandingkan mockup.

---

## Milestone 1d: PlaybackService dan pemutar

**`PlaybackService`** (`apps/desktop/src/main/playback/`, menumbuhkan kode spike; ADR 0008)
- `playback.start({ episodeId })`: `getStreams` (cache memori ±2 menit, STR-6) → **ranking** STR-1 (pilihan manual terakhir per anime, preferensi kualitas global default "tertinggi", server terakhir berhasil per source, urutan extension) → **probe** STR-2 (manifest atau `Range: bytes=0-1`, ±8 s, kandidat gagal berikutnya tanpa tampil) → buat sesi di `SessionStore` (header `Stream.headers`, session dan bucket media milik extension) → `{ url, position, streams[], activeStream }`.
- `playback.event` (fatal hls.js/media error, buffering lama) → **fallback** STR-3 (maks 3 percobaan, posisi dipertahankan, toast "Beralih ke server X"); 403/410 di tengah putar → panggil ulang `getStreams` satu kali (STR-4). `playback.switchStream` mempertahankan posisi (PLY-5). Pilihan **manual** disimpan di `anime.playback_prefs_json`, server berhasil per source di `settings` (STR-5). `playback.close` menghapus sesi.
- Perluas `anime://` handler: upstream lewat **session extension** + bucket media (bukan `defaultSession`); kode error `x-error-code` dipertahankan. Keputusan yang harus dibuktikan lebih dulu dengan probe kecil: `session.fetch()` vs `net.request` dengan header bridge untuk memilih session; hasilnya dicatat di ADR.
- Tahap lanjut: ranking `CODECS` terakhir bila tidak didukung `MediaSource.isTypeSupported` (PLY-12, P1).

**Pemutar** (`watch/$episodeId`, layar penuh tanpa shell; mockup `03`, `03b`–`03f`)
- `<video>` + hls.js (mp4/webm native), kebijakan retry yang wajar (bukan `FAST_FAIL` spike). State sementara di **Zustand** (posisi, buffer, kontrol; bukan Query).
- Kontrol PLY-2 (play/pause, seek bar + buffered, volume/mute dan kecepatan 0.5–2× diingat lewat `settings`, fullscreen, waktu, judul, kembali), **shortcut default PLY-3**, kontrol auto-hide + klik/klik ganda/roda (PLY-7), next/prev + **autoplay hitung mundur 5 s** yang bisa dibatalkan dan dimatikan (PLY-4), menu server/kualitas (PLY-5), indikator buffering dan **error state** dengan Coba lagi/Ganti server untuk jaringan, kedaluwarsa, diblokir (403/Cloudflare), dan codec (pakai deteksi frame ter-decode dari ADR 0009: audio jalan tanpa gambar = "format tidak didukung") (PLY-6), `powerSaveBlocker` lewat IPC (PLY-8), panel daftar episode (PLY-10, P1).
- Settings → Player minimal: autoplay, kualitas pilihan, lompatan seek. Ambang ditonton, remap shortcut, dan resume ditunda (Fase 2/5).

**Checkpoint 1d:** dari detail memutar episode HLS dan MP4 situs tiruan; pindah server mempertahankan posisi; stream yang kedaluwarsa memicu `getStreams` ulang lalu fallback; screenshot dibandingkan mockup.

---

## Milestone 1e: Penutup

- **E2E (Playwright `_electron`)**: app + `test-site` + `extensions/example` dimuat lewat folder dev → browse → detail → putar → ganti server → kedaluwarsa → fallback; Cloudflare tiruan; host crash dipulihkan. Tambahkan job e2e Linux (`xvfb-run`, sysctl AppArmor) ke `.github/workflows/ci.yml`.
- **Benchmark** `ma-ext bench` dengan extension contoh dan fixture sintetis (JSON besar, HTML besar, loop CPU): mengonfirmasi batas EXT-2 (64 MB, 2 s, 30/60 s) dan hasilnya dicatat di ADR.
- **ADR** (`docs/adr/`, Inggris): 0010 extension runtime QuickJS (+ benchmark, runtime/CLI MIT), 0011 HTML parsing di host dan network di main, 0012 network layer + header bridge per session, 0013 extension hanya dari folder dev (tanpa bawaan), 0014 PlaybackService (ranking, probe, fallback). Perbarui ADR 0008 (session extension, bridge).
- **Dokumen**: `docs/extensions.md` (draf panduan membuat extension, terhubung ke `ma-ext`), `docs/PRD.md` (EXT-2 terkonfirmasi, roadmap), README. Catatan: SDK belum terbit di npm (Fase 4), jadi extension luar memakai workspace/link sampai saat itu.

## File kunci

- `packages/extension-{sdk,runtime,cli}/src/**`, `packages/test-site/src/**`, `extensions/example/**`
- `packages/shared/src/ipc/{channels,contract}.ts`, `packages/shared/src/settings.ts` (setting pemutar)
- `apps/desktop/src/main/{network,extensions,playback}/**`, `src/extension-host/index.ts`, `src/main/db/repositories/{sources,anime,episodes}.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`
- `apps/desktop/electron.vite.config.ts` (entry host), `src/renderer/index.html` (CSP tetap; tidak ada `img-src` tambahan sampai `anime://cover`)
- `apps/desktop/src/renderer/src/routes/_app/browse/**`, `routes/_app/anime/$animeId.tsx`, `routes/watch/$episodeId.tsx`, `features/{browse,anime,player}/**`, `lib/{ipc,query}.ts`
- `.github/workflows/ci.yml`, `docs/adr/00{10..14}-*.md`, `docs/extensions.md`

Dipakai ulang dari Fase 0: `registerIpcHandlers`/`broadcast` (`main/ipc/register.ts`), `SessionStore` + `createAnimeHandler` + `rewriteManifest` (`main/playback/{sessions,proxy,m3u8}.ts`), `installHeaderBridge` (`main/playback/upstream.ts`, dipindah), `SettingsRepository`, `localQueryDefaults`/`createQueryClient` (`renderer/src/lib/query.ts`), `EmptyState`, `Button`, `RadioGroup`, token tema, pola test DB (`db/__tests__/migrate.test.ts`), fixture media, dan `runner.ts` (referensi pemasangan hls.js).

## Verifikasi

1. `pnpm lint`, `format:check`, `typecheck`, `test` hijau (test sandbox, network, repositori, kontrak IPC, PlaybackService: ranking, probe, fallback, kedaluwarsa).
2. `ma-ext build` + `ma-ext test` untuk `extensions/example` terhadap situs tiruan.
3. App (`pnpm dev` dan build) lewat driver Playwright: muat folder dev → browse → filter → detail → putar → ganti server → kedaluwarsa → fallback; screenshot Mocha dan Latte dibandingkan mockup.
4. Matikan proses host dan ulangi satu panggilan: UI pulih. Request dengan redirect ke skema non-http ditolak.
5. `pnpm e2e` hijau lokal (termasuk spike lama) dan di CI Linux.
6. `ma-ext bench` mengonfirmasi batas runtime; angka masuk ADR 0010.

## Gerbang keluar Fase 1

Fase 2 dimulai bila: (a) milestone 1a–1e selesai dan hijau; (b) pemutaran dari extension uji berjalan end-to-end dengan fallback dan error state; (c) benchmark runtime mengonfirmasi atau menyesuaikan EXT-2; (d) pemilik produk bisa menulis extension nyata di repo terpisah memakai `ma-ext` dari workspace. Spike 3 OS (ADR 0008/0009) masih terbuka dan harus hijau sebelum beta (setelah Fase 3).
